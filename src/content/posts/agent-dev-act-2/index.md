---
title: 古明地觉谈 Agent 应用 - 实战篇 2
description: ToyCoder LLM 客户端模块的实现解析
date: '2026-04-27'
order: 1
tags: [Agent, 技术, ToyCoder, LLM]
cover: ./cover.jpg
prev: agent-dev-act-1
next: agent-dev-act-3
---

本篇聚焦于 ToyCoder 的 `client/` 模块——LLM 客户端的实现。这是整个 Agent 系统的"通信层"，负责将消息发送给 LLM 服务商并解析返回结果。虽然概念上不复杂，但在工程实践中需要处理多 Key 轮询、自动重试、流式传输等细节问题。

## 模块结构

```
toycoder/client/
├── base.py            # 抽象基类与数据模型
└── openai_client.py   # OpenAI 兼容实现
```

模块的设计遵循**依赖倒置**原则：上层的 Agent 代码只依赖 `base.py` 中定义的抽象接口，不关心底层使用的是哪个服务商。这使得切换服务商（如从 OpenAI 切换到 DeepSeek）只需要修改配置文件，而不需要改动任何 Agent 逻辑。

## 数据模型

在定义客户端接口之前，首先需要定义 LLM 响应的数据模型。这些模型充当了 LLM API 返回值与 Agent 核心逻辑之间的"翻译层"——将服务商特定的响应格式转换为统一的内部表示。

```python
@dataclass
class ToolCallInfo:
    """LLM 返回的单次工具调用信息。"""
    id: str           # 工具调用的唯一标识，用于与后续的 tool 消息对齐
    name: str         # 工具名称
    arguments: str    # 工具参数的 JSON 字符串

@dataclass
class ChatResponse:
    """LLM 单次调用响应。"""
    content: str                                         # 文本内容
    tool_calls: list[ToolCallInfo] = field(default_factory=list)  # 工具调用列表
    usage: dict[str, int] = field(default_factory=dict)  # Token 用量
```

`ToolCallInfo` 中的 `id` 字段是一个关键设计点。在 OpenAI 的 API 规范中，每次工具调用都有一个唯一 ID，后续的 `tool` 角色消息必须通过 `tool_call_id` 与之对齐。这个 ID 是 LLM 维护多工具调用上下文的关键。

`ChatResponse` 的 `tool_calls` 字段为空列表时，表示模型给出了最终答复（纯文本）；不为空时，表示模型请求调用工具。这个约定直接决定了 ReAct 循环的控制流——在[基础篇 3](/posts/agent-dev-basis-3)中笔者已经介绍过这一逻辑。

## 抽象基类

`BaseClient` 定义了所有 LLM 客户端必须实现的接口：

```python
class BaseClient(ABC):
    @abstractmethod
    def chat(self, messages: list[dict[str, Any]], **kwargs: Any) -> ChatResponse:
        """发送聊天请求并获取响应。"""
        ...

    @abstractmethod
    def stream_chat(self, messages: list[dict[str, Any]], **kwargs: Any):
        """流式聊天，返回生成器逐步产出文本片段。"""
        ...
```

接口设计的要点：

1. **`messages` 统一使用 OpenAI 格式**。这不是因为偏爱 OpenAI，而是因为 OpenAI 的消息格式已经成为事实标准，绝大多数服务商都兼容这一格式。将消息格式的转换责任放在客户端内部而非调用方，可以让上层代码保持简洁。

2. **`**kwargs` 透传额外参数**。像 `tools`、`temperature`、`max_tokens` 这类参数不在基类签名中硬编码，而是通过 `**kwargs` 透传。这样基类不需要为每个可能的参数都定义形参，新增参数时也无需修改接口。

3. **流式与非流式分开**。`chat` 返回完整响应，`stream_chat` 返回生成器。虽然可以用一个方法加 `stream=True` 参数来统一，但分开后调用方的代码更清晰，类型签名也更准确。

## OpenAI 兼容客户端

`OpenAIClient` 是目前唯一的客户端实现，但它兼容所有遵循 OpenAI API 规范的服务商。

### 构造函数

```python
class OpenAIClient(BaseClient):
    def __init__(
        self,
        api_keys: list[str],
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o",
        max_retries: int = 2,
        retry_interval: float = 1.0,
    ) -> None:
        self._api_keys = api_keys
        self._base_url = base_url
        self._model = model
        self._max_retries = max_retries
        self._retry_interval = retry_interval
        self._current_key_index = 0
        self.last_response: ChatResponse | None = None
```

几个设计细节：

- **`api_keys` 是列表而非单个字符串**。在实际使用中，单个 API Key 往往有速率限制。通过维护多个 Key 并在失败时自动切换，可以提高服务的可用性。
- **`base_url` 参数**使得同一个客户端类可以对接不同的服务商——OpenAI、DeepSeek、Ollama 本地服务等，只要它们兼容 OpenAI API 格式。
- **`_current_key_index`** 记录当前使用的 Key 索引，成功调用后会更新为当前使用的 Key，实现"粘性"——倾向于继续使用上次成功的 Key。
- **`last_response`** 用于流式调用——流式传输过程中无法直接返回完整的 `ChatResponse`（因为生成器的返回值语义不够直观），因此将完整响应保存在实例属性中，供 ReAct 循环在流结束后读取。

### 非流式调用

`chat` 方法实现了**多 Key 轮询 + 自动重试**的调用策略：

```python
def chat(self, messages: list[dict[str, Any]], **kwargs: Any) -> ChatResponse:
    total_keys = len(self._api_keys)
    keys_tried = 0
    last_error: Exception | None = None

    while keys_tried < total_keys:
        key_idx = (self._current_key_index + keys_tried) % total_keys
        client = self._make_client(key_idx)
        retries = 0

        while retries <= self._max_retries:
            try:
                response = client.chat.completions.create(
                    model=kwargs.pop("model", self._model),
                    messages=messages,
                    **kwargs,
                )
                # ... 解析响应 ...
                self._current_key_index = key_idx
                return result
            except APIError as e:
                last_error = e
                retries += 1
                if retries <= self._max_retries:
                    time.sleep(self._retry_interval)
        keys_tried += 1

    raise RuntimeError(
        f"所有 API Key ({total_keys} 个) 均已耗尽重试次数"
    ) from last_error
```

这段逻辑的关键在于**两层循环**的设计：

- **外层循环**遍历所有 API Key。从当前 Key 开始，如果这个 Key 的重试次数用完了，就切换到下一个 Key。
- **内层循环**对当前 Key 进行重试。每次重试之间有 `retry_interval` 的间隔。

错误恢复策略是：
1. 当前 Key 的第一次调用失败 → 等待后重试（同一个 Key）
2. 当前 Key 的所有重试次数用完 → 切换到下一个 Key
3. 所有 Key 都失败 → 抛出异常，让上层处理

成功时的 `self._current_key_index = key_idx` 保证了下次调用会优先使用刚才成功的 Key，避免不必要的 Key 切换。

响应解析部分比较直接——从 OpenAI SDK 的响应对象中提取 `content`、`tool_calls` 和 `usage`，封装为统一的 `ChatResponse`：

```python
msg = response.choices[0].message

tool_calls: list[ToolCallInfo] = []
if msg.tool_calls:
    for tc in msg.tool_calls:
        tool_calls.append(
            ToolCallInfo(
                id=tc.id,
                name=tc.function.name,
                arguments=tc.function.arguments,
            )
        )

result = ChatResponse(
    content=msg.content or "",
    tool_calls=tool_calls,
    usage=usage,
)
```

这里 `msg.content or ""` 的处理是因为当模型返回工具调用时，`content` 可能为 `None`。将其统一为空字符串可以避免上层代码到处做 `None` 检查。

### 流式调用

流式调用是 ToyCoder 实际使用的主要模式，它让用户能看到 Agent 的实时输出，而不是等待完整响应后才看到结果。

```python
def stream_chat(
    self, messages: list[dict[str, Any]], **kwargs: Any
) -> Generator[str, None, None]:
    client = self._make_client(self._current_key_index)
    stream = client.chat.completions.create(
        model=kwargs.pop("model", self._model),
        messages=messages,
        stream=True,
        **kwargs,
    )

    full_content = ""
    tool_calls_map: dict[int, dict[str, str]] = {}

    for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta is None:
            continue

        if delta.content:
            full_content += delta.content
            yield delta.content

        if delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index
                if idx not in tool_calls_map:
                    tool_calls_map[idx] = {"id": "", "name": "", "arguments": ""}
                if tc_delta.id:
                    tool_calls_map[idx]["id"] = tc_delta.id
                if tc_delta.function:
                    if tc_delta.function.name:
                        tool_calls_map[idx]["name"] = tc_delta.function.name
                    if tc_delta.function.arguments:
                        tool_calls_map[idx]["arguments"] += tc_delta.function.arguments

    # 流结束后构建完整响应
    tool_calls = [
        ToolCallInfo(id=tc["id"], name=tc["name"], arguments=tc["arguments"])
        for idx, tc in sorted(tool_calls_map.items())
    ]
    self.last_response = ChatResponse(content=full_content, tool_calls=tool_calls)
```

流式调用的核心难点在于**工具调用信息的拼接**。在非流式模式下，一个完整的 `tool_call` 在一次响应中就能拿到全部信息。但在流式模式下，一个工具调用的 `id`、`name` 和 `arguments` 可能分散在多个 chunk 中——尤其是 `arguments`（JSON 字符串），通常会被分成多个片段逐步传输。

`tool_calls_map` 使用工具调用的 `index`（序号）作为 key，将同一个工具调用的多个 chunk 拼接起来。文本内容则通过 `yield` 实时产出给调用方，同时累积到 `full_content` 中用于最终的完整响应。

流结束后，完整的 `ChatResponse` 被保存在 `self.last_response` 中。这是一个重要的设计——ReAct 循环中的 `stream_react` 函数需要在流式输出文本之后，检查是否有工具调用需要处理：

```python
# stream_react 中的使用方式（见 agent/react.py）
for chunk in client.stream_chat(messages, **kwargs):
    full_content += chunk
    yield chunk

resp = client.last_response  # 流结束后获取完整响应（包括 tool_calls）
```

### 为什么流式调用没有重试机制

读者可能注意到，`stream_chat` 没有像 `chat` 那样实现多 Key 轮询和重试。这是一个有意的取舍：

1. **流式连接一旦建立，中途失败的概率很低**。大部分错误发生在连接建立阶段，而不是传输阶段。
2. **流式调用中途失败后的恢复代价很高**。如果在流式传输到一半时失败，已经 `yield` 出去的文本片段无法撤回，重试会导致重复输出。
3. **简化实现**。在教学项目中，保持代码简洁比覆盖所有边界情况更重要。

如果需要为流式调用添加重试，一种可行的方案是在 `stream_chat` 外部包装重试逻辑，在首次 chunk 产出之前进行重试，一旦开始产出就不再重试。

## 与配置模块的衔接

在实际使用中，`OpenAIClient` 的实例化参数来自配置模块。在 `app.py` 的 `setup()` 方法中：

```python
provider = self.config.providers[provider_name]
self.client = OpenAIClient(
    api_keys=provider.api_keys,
    base_url=provider.base_url,
    model=provider.models.get("default", "gpt-4o"),
    max_retries=self.config.agent.max_retries,
    retry_interval=self.config.agent.retry_interval,
)
```

配置文件中的 `providers` 段对应 `ProviderConfig` 数据类，其中 `api_keys` 是数组、`base_url` 指向服务商的 API 端点、`models` 字典中 `default` 键指定默认使用的模型。重试参数则来自 `agent` 配置段。

这种配置驱动的设计使得用户可以在不修改代码的情况下：
- 切换到不同的 LLM 服务商（修改 `base_url`）
- 更换模型（修改 `models.default`）
- 调整容错策略（修改 `max_retries` 和 `retry_interval`）
- 添加多个 API Key 实现负载均衡（向 `api_keys` 数组中添加更多 Key）

## 小结

`client/` 模块的实现虽然不长（两个文件加起来不到 200 行），但体现了几个重要的工程原则：

1. **抽象与实现分离**。`BaseClient` 定义接口，`OpenAIClient` 提供实现，上层代码只依赖抽象。
2. **容错优先**。多 Key 轮询和自动重试使得服务更加稳定，不会因为单个 Key 的速率限制或临时故障而中断用户的工作。
3. **统一数据模型**。`ChatResponse` 和 `ToolCallInfo` 将服务商特定的响应格式转换为内部表示，隔离了外部 API 变化对核心逻辑的影响。
4. **流式与完整响应的桥接**。通过 `last_response` 属性，解决了生成器无法方便返回元数据的问题。

下一篇将介绍 `tool/` 模块——工具系统的实现，包括工具基类的自动 Schema 生成、权限控制机制和内置工具的设计。

---
title: 古明地觉谈 Agent 应用 - 进阶篇 3
description: 介绍会话管理，记忆等上下文相关的 Agent 技术。
date: '2026-04-25'
order: 1
tags: [Agent, 技术, 会话管理, 记忆, 知识库, Python]
cover: ./cover.png
prev: agent-dev-advanced-2
next: agent-dev-advanced-4
---

实际上根据前述的文章，从原理上来说读者已经能够构建一个功能完善的 Agent 了，但我们肯定希望 Agent 能够：
- 记住之前的对话内容，能够在后续的对话中使用这些信息。
- 能够进行会话管理，不同的会话能够独立进行，互不干扰。

在本篇文章中，笔者将介绍一些实现这些功能的技术和方法，同时笔者也鼓励读者去了解其他项目，笔者在文章中只能介绍基本思想和简单的实现。

## 会话管理

### 提交多轮对话给 LLM

在前面的文章中，我们已经看到 `messages` 列表记录了每一轮的 `user`、`assistant`、`tool` 消息，并在下一次调用时整体提交给 LLM。实际上，这就是 OpenAI API 实现多轮对话的核心机制：LLM 本身是无状态的，所有的“记忆”都来自每次请求时传入的 `messages` 列表。

标准的 OpenAI SDK 提交多轮对话的方式如下：

```python
from openai import OpenAI

client = OpenAI(api_key="your_api_key")

messages = [
    {"role": "system", "content": "你是一个有帮助的助理。"},
    {"role": "user", "content": "法国的首都是哪里？"},
]

# 第一轮
response = client.chat.completions.create(model="gpt-4o", messages=messages)
assistant_msg = response.choices[0].message.content
messages.append({"role": "assistant", "content": assistant_msg})

# 第二轮——将之前的完整对话历史一并发送
messages.append({"role": "user", "content": "那里有什么著名的景点？"})
response = client.chat.completions.create(model="gpt-4o", messages=messages)
```

回到我们在[基础篇 3](/posts/agent-dev-basis-3)中的封装，`run_react` 函数内部维护的 `messages` 列表实际上已经实现了单次调用内的多轮对话：

```python
def run_react(client: OpenAIClient, user_input: str, max_steps: int = 8) -> str:
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_input},
    ]
    for _ in range(max_steps):
        resp = client.chat(messages)
        messages.append({"role": "assistant", "content": resp.content, ...})
        # ... 工具调用结果也追加到 messages 中
```

但这个实现有一个很明显的局限：`messages` 是函数内的局部变量，每次调用 `run_react` 都会从一个全新的空列表开始。要让 Agent 具备跨轮次的对话能力，我们需要将 `messages` 提升到会话级别。一个最直接的做法是将 `messages` 作为参数传入并在外部维护：

```python
def run_react(
    client: OpenAIClient,
    messages: list[dict],
    max_steps: int = 8,
) -> str:
    """执行 ReAct 循环。messages 由调用方维护，支持多轮对话。"""
    for _ in range(max_steps):
        resp = client.chat(messages)
        messages.append({
            "role": "assistant",
            "content": resp.content,
            "tool_calls": [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.function.name, "arguments": c.function.arguments},
                }
                for c in resp.tool_calls
            ],
        })
        if not resp.tool_calls:
            return resp.content
        for call in resp.tool_calls:
            observation = default_manager.dispatch(call.function.name, call.function.arguments)
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(observation, ensure_ascii=False, default=str),
            })
    raise RuntimeError(f"ReAct 循环超过 {max_steps} 步仍未收敛")

# 使用方式
messages = [{"role": "system", "content": SYSTEM_PROMPT}]

# 第一轮
messages.append({"role": "user", "content": "法国的首都是哪里？"})
answer1 = run_react(client, messages)
print(answer1)  # 巴黎

# 第二轮——messages 中已经包含了第一轮的历史
messages.append({"role": "user", "content": "那里有什么著名的景点？"})
answer2 = run_react(client, messages)
print(answer2)  # LLM 能理解"那里"指的是巴黎
```

这样我们就实现了跨轮次的多轮对话。`messages` 列表作为整个会话的“状态”，在外部被持有和管理。

### 会话控制

在实际的应用中，我们通常需要支持多个独立的会话。例如一个聊天应用的不同对话窗口、一个群聊机器人在不同群组中的对话，这些会话之间应当互不干扰。

一个非常简单的想法是，用一个唯一标识（Session ID）来区分不同的会话，并为每个会话独立维护其 `messages` 列表。

```python
# session/manager.py
import uuid
from dataclasses import dataclass, field

@dataclass
class Session:
    """表示一个独立的对话会话。"""
    session_id: str
    messages: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    """可以存放任意元信息，如用户 ID、创建时间等。"""

    def add_message(self, role: str, content: str, **kwargs) -> None:
        msg = {"role": role, "content": content, **kwargs}
        self.messages.append(msg)

class SessionManager:
    """会话管理器，负责创建、检索和管理多个会话。"""

    def __init__(self, system_prompt: str = "") -> None:
        self._sessions: dict[str, Session] = {}
        self._system_prompt = system_prompt

    def create_session(self, session_id: str | None = None, **metadata) -> Session:
        """创建一个新会话。"""
        sid = session_id or str(uuid.uuid4())
        session = Session(session_id=sid, metadata=metadata)
        if self._system_prompt:
            session.add_message("system", self._system_prompt)
        self._sessions[sid] = session
        return session

    def get_session(self, session_id: str) -> Session | None:
        """根据 ID 获取会话，不存在则返回 None。"""
        return self._sessions.get(session_id)

    def get_or_create(self, session_id: str, **metadata) -> Session:
        """获取会话，不存在则自动创建。"""
        if session_id not in self._sessions:
            return self.create_session(session_id, **metadata)
        return self._sessions[session_id]

    def delete_session(self, session_id: str) -> None:
        """删除一个会话。"""
        self._sessions.pop(session_id, None)

    def list_sessions(self) -> list[str]:
        """列出所有会话 ID。"""
        return list(self._sessions.keys())
```

有了 `SessionManager` 之后，我们就可以将 `run_react` 与会话管理串联起来：

```python
# agent/react.py
from session.manager import SessionManager

session_mgr = SessionManager(system_prompt=SYSTEM_PROMPT)

def chat(client: OpenAIClient, session_id: str, user_input: str) -> str:
    session = session_mgr.get_or_create(session_id)
    session.add_message("user", user_input)
    answer = run_react(client, session.messages)
    return answer
```

每个 `session_id` 对应一个独立的 `messages` 列表，不同会话之间完全隔离。

注意到上面的 `SYSTEM_PROMPT` 仍然是一个硬编码的字符串常量。在[基础篇 4](/posts/agent-dev-basis-4)中，笔者曾介绍过通过 `PromptManager` 将 Prompt 作为 YAML 资源文件来管理的方法。在会话管理中，我们同样应当将 System Prompt 纳入统一管理。例如，我们可以定义如下的 YAML 模板：

```yaml
# prompts/templates/chat_agent.yaml

group_chat:
    description: 群聊助手
    system: |
        你是一个群聊助手，能够理解群聊上下文并给出有帮助的回复。
        请注意区分不同用户的发言，并在回复时考虑对话的整体语境。

summarizer:
    description: 对话摘要生成
    system: |
        你是一个文本摘要助手。
    user: |
        请将以下对话历史总结为一段简洁的摘要，保留关键信息和结论，
        省略中间的推理过程和重复内容。摘要应当包含：
        1. 用户提出的主要问题或需求
        2. 已经达成的结论或完成的任务
        3. 任何重要的约定或偏好

        对话历史：
        {conversation}

memory_extractor:
    description: 用户记忆提取
    system: |
        你是一个信息提取助手，擅长从对话中提炼关键的用户信息。
    user: |
        请从以下对话中提取关于用户 "{user_name}" 的重要信息。

        已有的记忆：
        {existing_memory}

        本次对话内容：
        {conversation}

        请输出一个 JSON 对象，格式如下：
        {{"new_facts": ["新发现的事实1", "新发现的事实2"],
         "updated_summary": "更新后的用户总结（整合已有记忆和新信息）"}}

        注意：
        - 只提取与该用户直接相关的信息（偏好、身份、习惯等）
        - 不要记录临时的、无长期价值的信息
        - 如果没有值得记忆的新信息，new_facts 为空数组，updated_summary 保持原内容
```

然后 `SessionManager` 可以通过 `PromptManager` 来加载 System Prompt，而不是直接接收字符串：

```python
from prompt.manager import PromptManager

prompt_mgr = PromptManager()
prompt_data = prompt_mgr.load_prompt("chat_agent")
system_prompt = prompt_data["group_chat"]["system"]

session_mgr = SessionManager(system_prompt=system_prompt)
```

在后面的小节中，笔者也会利用这份 YAML 中定义的 `summarizer` 和 `memory_extractor` 模板。

当然，上述的 `SessionManager` 将会话存储在内存中，应用重启后所有会话都会丢失。在生产环境中，你需要将会话持久化到数据库或文件系统中。笔者在这里就不展开了，具体的存储方案取决于你的技术栈和场景需求。

### 处理非 `user`-`assistant` 结构的对话

在标准的 OpenAI API 调用中，对话历史遵循严格的 `user`-`assistant` 交替结构。但在很多实际场景中，输入并不是这样的格式，笔者以群聊机器人为例说明。

在群聊中，机器人被触发之前可能已经有多个用户发了很多条消息。这些消息不是单个 `user` 的输入，而是多人多条的消息流。如果我们直接将它们逐条作为 `user` 消息提交，不仅违反了 API 的交替结构要求，也会导致 LLM 无法区分不同发言者的身份。

一种处理方式是将触发前的消息流预处理合并为一条 `user` 消息，在其中标注每条消息的发送者和时间，让 LLM 能够理解群聊的上下文。

```python
# preprocess/group_chat.py
from dataclasses import dataclass
from datetime import datetime

@dataclass
class GroupMessage:
    """群聊中的一条原始消息。"""
    sender: str       # 发送者昵称或 ID
    content: str      # 消息内容
    timestamp: datetime

def merge_group_messages(
    messages: list[GroupMessage],
    bot_name: str,
    trigger_message: GroupMessage,
) -> str:
    """将群聊消息流合并为一条结构化的 user 输入。

    Args:
        messages: 触发前的消息历史（按时间排序）。
        bot_name: 机器人自身的名称，用于过滤自己的消息。
        trigger_message: 触发机器人的那条消息。
    """
    parts: list[str] = []

    # 上下文消息
    context_msgs = [m for m in messages if m.sender != bot_name]
    if context_msgs:
        parts.append("## 群聊上下文")
        for msg in context_msgs:
            time_str = msg.timestamp.strftime("%H:%M:%S")
            parts.append(f"[{time_str}] {msg.sender}: {msg.content}")

    # 触发消息
    parts.append(f"\n## 当前需要回复的消息")
    parts.append(f"{trigger_message.sender}: {trigger_message.content}")

    return "\n".join(parts)
```

使用示例：

```python
# 假设群聊中发生了这样的对话：
raw_messages = [
    GroupMessage("Alice", "今天天气真好", datetime(2026, 4, 24, 10, 0, 0)),
    GroupMessage("Bob", "是啊，要不要出去吃饭", datetime(2026, 4, 24, 10, 0, 30)),
    GroupMessage("Alice", "好呀，吃什么", datetime(2026, 4, 24, 10, 1, 0)),
]
trigger = GroupMessage("Bob", "@机器人 推荐一下附近的餐厅", datetime(2026, 4, 24, 10, 1, 30))

merged_input = merge_group_messages(raw_messages, bot_name="机器人", trigger_message=trigger)
# merged_input 会被格式化为：
# ## 群聊上下文
# [10:00:00] Alice: 今天天气真好
# [10:00:30] Bob: 是啊，要不要出去吃饭
# [10:01:00] Alice: 好呀，吃什么
#
# ## 当前需要回复的消息
# Bob: @机器人 推荐一下附近的餐厅

# 然后将 merged_input 作为一条 user 消息提交给 Agent
session = session_mgr.get_or_create(session_id="group-123")
session.add_message("user", merged_input)
answer = run_react(client, session.messages)
```

这样 LLM 就能理解群聊的上下文，它知道 Alice 和 Bob 在讨论出去吃饭，所以在推荐餐厅时可以考虑到这些信息。

无论原始输入的格式多么复杂，我们总是将其归一化为一条结构化的 `user` 消息。结构化的格式（如标题、时间戳、发送者标注）帮助 LLM 解析和理解原始信息的层次和关系。

### 上下文管理

随着对话的进行，`messages` 列表会不断增长。当对话历史超过 LLM 的上下文窗口大小时，API 调用会直接报错；即便没有超过窗口限制，过长的上下文也会拖慢响应速度、增加 Token 费用，并且可能导致 LLM 对早期信息的关注度下降。因此我们需要一些策略来管理上下文的大小。

笔者在这里介绍截断和压缩这两种常见的方法。

#### 截断

截断是最简单的策略：当 `messages` 长度超过设定的阈值时，丢弃最早的消息，只保留最近的 N 轮对话。

```python
# context/truncation.py

def truncate_messages(
    messages: list[dict],
    max_turns: int = 20,
) -> list[dict]:
    """截断对话历史，保留 system prompt 和最近的 N 轮对话。

    Args:
        messages: 完整的对话历史。
        max_turns: 保留的最大轮数（一个 user + assistant 为一轮）。
    """
    # 始终保留 system prompt
    system_msgs = [m for m in messages if m["role"] == "system"]
    non_system = [m for m in messages if m["role"] != "system"]

    # 从后往前数，保留最近的 max_turns 轮
    # 注意要保持消息的完整性：不能截断 tool_calls 和对应的 tool 消息
    if len(non_system) <= max_turns * 2:
        return messages  # 未超限，不截断

    truncated = non_system[-(max_turns * 2):]

    # 确保截断点不在 tool_calls 序列中间
    # 如果第一条是 tool 消息，说明截断到了工具调用的中间，需要继续往前找到对应的 assistant 消息
    while truncated and truncated[0]["role"] == "tool":
        truncated.pop(0)

    return system_msgs + truncated
```

截断的优点是实现简单、计算成本为零。但缺点也很明显，被丢弃的消息中可能包含关键信息，这会导致 LLM 在后续对话中“遗忘”早期的约定或事实。

#### 压缩

压缩策略通过 LLM 将历史对话总结为一段摘要，然后用这段摘要替换原始的对话历史。这样既控制了上下文长度，又在一定程度上保留了关键信息。

这里的摘要 Prompt 我们已经在前面的 `chat_agent.yaml` 中定义好了（`summarizer` 部分），现在通过 `PromptManager` 来加载并使用它：

```python
# context/compression.py
from client.base import BaseClient
from prompt.manager import PromptManager

prompt_mgr = PromptManager()

def compress_messages(
    client: BaseClient,
    messages: list[dict],
    keep_recent: int = 6,
) -> list[dict]:
    """压缩对话历史：将早期消息总结为摘要，保留最近的几条消息。

    Args:
        client: 用于生成摘要的 LLM 客户端。
        messages: 完整的对话历史。
        keep_recent: 保留最近的消息条数（不被压缩）。
    """
    system_msgs = [m for m in messages if m["role"] == "system"]
    non_system = [m for m in messages if m["role"] != "system"]

    if len(non_system) <= keep_recent:
        return messages  # 消息不多，无需压缩

    # 将需要压缩的早期消息格式化为文本
    to_compress = non_system[:-keep_recent]
    conversation_text = "\n".join(
        f'{m["role"]}: {m["content"]}'
        for m in to_compress
        if m["role"] in ("user", "assistant") and m.get("content")
    )

    # 通过 PromptManager 加载并渲染摘要 Prompt
    prompt_data = prompt_mgr.load_prompt("chat_agent")
    summarizer = prompt_data["summarizer"]
    summary_messages = [
        {"role": "system", "content": summarizer["system"]},
        {"role": "user", "content": summarizer["user"].format(conversation=conversation_text)},
    ]

    # 调用 LLM 生成摘要
    summary_resp = client.chat(summary_messages)

    # 用摘要消息替换被压缩的消息
    summary_msg = {
        "role": "user",
        "content": f"[以下是之前对话的摘要]\n{summary_resp.content}\n[摘要结束，以下是最近的对话]",
    }

    recent = non_system[-keep_recent:]
    return system_msgs + [summary_msg] + recent
```

在实际使用中，我们可以将截断和压缩组合使用：当对话历史达到一定长度时先进行压缩，如果压缩后仍然过长再进行截断。你也可以在 `SessionManager` 中加入自动管理的逻辑，在每次 `add_message` 后检查是否需要触发上下文管理：

```python
# session/manager.py

class Session:
    # ...
    def add_message(self, role: str, content: str, **kwargs) -> None:
        msg = {"role": role, "content": content, **kwargs}
        self.messages.append(msg)
        # 自动上下文管理
        if len(self.messages) > self._max_messages:
            self.messages = compress_messages(self._client, self.messages)
```

## 记忆

### 上下文承担了短期记忆的功能

通过前面对会话管理的讨论，读者应当已经注意`messages` 列表本身就是 Agent 的短期记忆。

LLM 是无状态的，它没有任何内建的记忆机制。当我们在一次会话中能够让 LLM “记住”之前的对话内容时，这并不是因为 LLM 真的在某个地方存储了记忆，而是因为我们每次都把完整的对话历史作为上下文传给了它。LLM 所做的，只是在给定的上下文中生成一个合理的续写。

这意味着 Agent 的“短期记忆”与人类的短期记忆有着本质的区别。人类的短期记忆是模糊的、衰减的、有选择性的；而 Agent 的上下文记忆是精确的、不衰减的（在窗口内）、无选择性的。但它们也有一个共同点：容量有限。LLM 的上下文窗口虽然大得多（数万甚至数十万 Token），但同样有其边界。并且根据经验，随着上下文长度的增加，LLM 对早期信息的“注意力”会逐渐稀释，这在效果上非常类似于人类短期记忆的衰减。

前面介绍的上下文管理技术（截断和压缩）实际上就是在管理这个短期记忆的容量。截断相当于“遗忘”，压缩相当于“归纳记忆”，二者都是为了在有限的容量内保留尽可能多的有用信息。

既然上下文充当了短期记忆，那么一个自然的问题就是有没有办法让 Agent 拥有跨会话的长期记忆？答案是肯定的，但这需要我们自行实现一套记忆的存储、检索和注入机制。

### 长期记忆的实现

长期记忆实际上就是数据库，将重要信息从对话上下文中提取出来，持久化存储到外部系统，并在后续需要时检索并注入到上下文中。

笔者以群聊机器人为例来展示一种实用的长期记忆实现方式。在群聊场景中，机器人会与不同的用户交互，我们希望机器人能够记住每个用户的偏好和关键信息。例如，Alice 提到过她不吃辣，那么下次有人让机器人推荐餐厅时，如果 Alice 在场，机器人就应当考虑到这一点。

#### 记忆模型

首先定义记忆的数据结构和存储：

```python
# memory/store.py
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

@dataclass
class UserMemory:
    """某个用户的记忆条目。"""
    user_id: str
    summary: str
    """关于该用户的总结性记忆。"""
    facts: list[str] = field(default_factory=list)
    """该用户相关的离散事实（如偏好、身份信息等）。"""
    last_updated: str = ""

class MemoryStore:
    """简单的基于文件的记忆存储。生产环境中可替换为数据库实现。"""

    def __init__(self, storage_path: str = "data/memories.json") -> None:
        self._path = Path(storage_path)
        self._memories: dict[str, UserMemory] = {}
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            data = json.loads(self._path.read_text(encoding="utf-8"))
            for uid, mem in data.items():
                self._memories[uid] = UserMemory(**mem)

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {}
        for uid, mem in self._memories.items():
            data[uid] = {
                "user_id": mem.user_id,
                "summary": mem.summary,
                "facts": mem.facts,
                "last_updated": mem.last_updated,
            }
        self._path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_memory(self, user_id: str) -> UserMemory | None:
        return self._memories.get(user_id)

    def update_memory(self, memory: UserMemory) -> None:
        memory.last_updated = datetime.now().isoformat()
        self._memories[memory.user_id] = memory
        self._save()
```

#### 记忆的提取与更新

在每次对话结束后，我们通过 LLM 从对话内容中提取出值得记忆的信息，并更新到该用户的记忆中。同样，记忆提取的 Prompt 已经在 `chat_agent.yaml` 的 `memory_extractor` 中定义好了，我们通过 `PromptManager` 来加载：

```python
# memory/extractor.py
import json
from client.base import BaseClient
from prompt.manager import PromptManager
from .store import MemoryStore, UserMemory

prompt_mgr = PromptManager()

def extract_and_update_memory(
    client: BaseClient,
    store: MemoryStore,
    user_id: str,
    user_name: str,
    conversation: str,
) -> None:
    """从对话中提取记忆并更新存储。"""
    existing = store.get_memory(user_id)
    existing_text = ""
    if existing:
        existing_text = f"总结：{existing.summary}\n事实：{', '.join(existing.facts)}"
    else:
        existing_text = "（暂无记忆）"

    # 通过 PromptManager 加载并渲染记忆提取 Prompt
    prompt_data = prompt_mgr.load_prompt("chat_agent")
    extractor = prompt_data["memory_extractor"]
    extract_messages = [
        {"role": "system", "content": extractor["system"]},
        {"role": "user", "content": extractor["user"].format(
            user_name=user_name,
            existing_memory=existing_text,
            conversation=conversation,
        )},
    ]
    resp = client.chat(extract_messages)

    try:
        result = json.loads(resp.content)
    except json.JSONDecodeError:
        return  # 解析失败则跳过本次更新

    memory = existing or UserMemory(user_id=user_id, summary="")
    if result.get("new_facts"):
        memory.facts.extend(result["new_facts"])
    if result.get("updated_summary"):
        memory.summary = result["updated_summary"]

    store.update_memory(memory)
```

#### 记忆的注入

在每次对话开始时，我们从存储中检索出相关用户的记忆，并注入到上下文中：

```python
# memory/inject.py
from .store import MemoryStore

def build_memory_context(store: MemoryStore, user_ids: list[str]) -> str:
    """根据参与对话的用户 ID 列表，构建记忆上下文文本。"""
    parts: list[str] = []
    for uid in user_ids:
        memory = store.get_memory(uid)
        if memory and (memory.summary or memory.facts):
            parts.append(f"### {uid}")
            if memory.summary:
                parts.append(f"总结：{memory.summary}")
            if memory.facts:
                parts.append(f"已知事实：{'；'.join(memory.facts)}")
    if not parts:
        return ""
    return "## 用户记忆\n以下是你对参与对话的用户的了解：\n" + "\n".join(parts)
```

#### 在群聊机器人中的完整串联

将记忆系统与前面的会话管理、群聊预处理组合起来，完整的流程如下：

```python
# bot/group_chat_bot.py
from client.openai_client import OpenAIClient
from session.manager import SessionManager
from prompt.manager import PromptManager
from memory.store import MemoryStore
from memory.extractor import extract_and_update_memory
from memory.inject import build_memory_context
from preprocess.group_chat import GroupMessage, merge_group_messages
from agent.react import run_react

client = OpenAIClient()
prompt_mgr = PromptManager()

# 通过 PromptManager 加载群聊助手的 System Prompt
prompt_data = prompt_mgr.load_prompt("chat_agent")
session_mgr = SessionManager(system_prompt=prompt_data["group_chat"]["system"])
memory_store = MemoryStore()

def handle_group_trigger(
    group_id: str,
    history: list[GroupMessage],
    trigger: GroupMessage,
) -> str:
    """处理群聊中机器人被触发的事件。"""

    # 1. 预处理：合并群聊消息为结构化输入
    merged_input = merge_group_messages(history, bot_name="机器人", trigger_message=trigger)

    # 2. 记忆注入：检索相关用户的记忆
    involved_users = list({m.sender for m in history} | {trigger.sender})
    memory_context = build_memory_context(memory_store, involved_users)

    # 3. 获取/创建会话
    session = session_mgr.get_or_create(group_id)

    # 将记忆和消息注入上下文
    if memory_context:
        # 将记忆信息作为 system 消息的补充注入
        session.messages[0]["content"] += f"\n\n{memory_context}"

    session.add_message("user", merged_input)

    # 4. 执行 Agent
    answer = run_react(client, session.messages)

    # 5. 异步提取记忆（实际应用中应在后台执行，避免阻塞响应）
    conversation_text = f"{trigger.sender}: {trigger.content}\n机器人: {answer}"
    extract_and_update_memory(
        client, memory_store,
        user_id=trigger.sender,
        user_name=trigger.sender,
        conversation=conversation_text,
    )

    return answer
```

通过这套机制，群聊机器人能够在不同的对话中逐渐积累对每个用户的了解。当 Alice 在某次对话中提到“我不吃辣”时，这个信息会被提取出来存入 `MemoryStore`。在后续的对话中，即使已经过了很久，只要 Alice 参与了对话，机器人就能从长期记忆中检索到这条信息并将其注入上下文，从而在推荐餐厅时避开辣的选项。

当然，笔者在这里展示的是一种基本的实现思路。在生产环境中，你可能还需要考虑：记忆的容量上限与淘汰策略、使用向量数据库来支持语义检索、记忆的可信度和时效性管理等问题。

## 知识库

在这里，笔者将“知识库”作为一个更广义的概念来介绍，它既可以是 Agent 的长期记忆，也可以是外部的事实数据库、文档库等。知识库的核心功能是提供一个结构化的存储和检索机制，让 Agent 能够在需要时访问和利用这些信息。

事实上，让 LLM 利用外部知识库来完成特定任务，甚至能够超过微调模型的效果。因此在 Agent 的设计中，知识库的集成是一个非常重要的环节。读者可以自行了解包括基于向量数据库的语义检索、基于关系数据库的结构化查询等。
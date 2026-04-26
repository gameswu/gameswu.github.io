---
title: 古明地觉谈 Agent 应用 - 实战篇 3
description: ToyCoder 工具系统的实现解析
date: '2026-04-28'
order: 1
tags: [Agent, 技术, ToyCoder, 工具系统]
cover: ./cover.jpg
prev: agent-dev-act-2
next: agent-dev-act-4
---

本篇聚焦于 ToyCoder 的 `tool/` 模块——工具系统的实现。工具系统是 Agent 能力的物质基础：Agent 的"智能"来自 LLM，但"能力"来自工具。一个没有工具的 Agent 只能输出文本，无法实际操作文件、执行命令或与外部系统交互。

## 模块结构

```
toycoder/tool/
├── base.py             # Tool 基类：函数 → 工具的自动封装
├── permission.py       # 权限等级枚举
├── manager.py          # ToolManager：注册、派发、权限控制
├── mcp_tool.py         # MCP 工具适配器
└── builtin/            # 内置工具
    ├── file_ops.py     # 文件操作（read/write/edit/list）
    ├── search.py       # 搜索（glob/grep）
    ├── shell.py        # Shell 命令执行
    └── question.py     # 用户交互
```

模块内部的依赖关系是清晰的单向链：`permission.py` → `base.py` → `manager.py`。内置工具和 MCP 适配器都依赖 `manager.py` 和 `base.py`，但彼此之间没有依赖。

## 权限等级

在[进阶篇 4](/posts/agent-dev-advanced-4)中，笔者已经介绍了工具权限控制的设计思路。在 ToyCoder 中，权限等级的定义非常简洁：

```python
class PermissionLevel(Enum):
    SAFE = "safe"
    """默认启用，自动批准。如：读取文件、搜索代码。"""

    SENSITIVE = "sensitive"
    """默认启用，每次调用需人工确认（可授予会话级自动批准）。如：写入文件。"""

    DANGEROUS = "dangerous"
    """默认关闭，需手动开启后才能使用。如：执行任意 Shell 命令。"""
```

三个等级对应了三种不同的审批策略：
- **SAFE**：完全自动化，LLM 调用即执行，不做任何拦截。
- **SENSITIVE**：默认启用但需要确认。每次调用时弹出确认对话框，用户可以选择"允许"（一次性）、"始终允许"（会话级自动批准）或"拒绝"。
- **DANGEROUS**：默认关闭，用户必须通过 `/tool enable` 命令手动启用后才能使用。

## Tool 基类

`Tool` 基类是工具系统的核心——它负责将一个普通的 Python 函数自动封装为可被 LLM 调用的工具。封装过程中最关键的一步是**从函数签名自动生成 JSON Schema**，避免了手工维护 Schema 的繁琐和容易出错的问题。

### 构造函数

```python
class Tool:
    def __init__(
        self,
        func: Callable[..., Any],
        *,
        name: str | None = None,
        description: str | None = None,
        permission: PermissionLevel = PermissionLevel.SAFE,
    ) -> None:
        self.func = func
        self.name = name or func.__name__
        self.description = description or (
            inspect.getdoc(func) or ""
        ).split("\n\n", 1)[0]
        self.permission = permission
        self._params_model = self._build_params_model(func)
```

构造函数的设计体现了"约定优于配置"的原则：
- **名称**默认使用函数名。`read_file` 函数自动变成 `read_file` 工具。
- **描述**默认从 docstring 的第一段提取。`"""读取指定文件的内容。支持分段读取。"""` 会提取 `"读取指定文件的内容。支持分段读取。"` 作为描述。
- **权限**默认为 `SAFE`，只有写操作和危险操作需要显式标注。

当然，所有默认值都可以通过参数覆盖——当函数名不适合作为工具名，或者 docstring 不够精炼时，可以手动指定。

### Schema 自动生成

Schema 自动生成是 `Tool` 类中最精巧的部分。它利用 Python 的类型注解和 Pydantic 的 `create_model` 函数，将函数签名动态转换为 JSON Schema：

```python
@staticmethod
def _build_params_model(func: Callable[..., Any]) -> type[BaseModel]:
    sig = inspect.signature(func)
    hints = get_type_hints(func, include_extras=True)
    fields: dict[str, Any] = {}

    for pname, param in sig.parameters.items():
        if pname == "self" or param.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        ):
            continue
        annotation = hints.get(pname, str)
        default = (
            param.default
            if param.default is not inspect.Parameter.empty
            else ...
        )
        fields[pname] = (
            annotation,
            default if default is not ... else Field(...),
        )

    return create_model(f"{func.__name__}_Params", **fields)
```

这段代码的工作流程：

1. **提取函数签名和类型提示**。`inspect.signature` 获取参数列表，`get_type_hints` 获取类型注解（包括 `Annotated` 中的元数据）。

2. **过滤特殊参数**。跳过 `self`（类方法）、`*args` 和 `**kwargs`（不定参数），只处理普通参数。

3. **构建字段定义**。每个参数转换为 Pydantic 字段：类型注解决定字段类型，有默认值的参数变为可选字段，没有默认值的参数变为必填字段（`Field(...)`）。

4. **动态创建 Pydantic 模型**。`create_model` 在运行时生成一个 `BaseModel` 子类，这个模型可以直接导出 JSON Schema。

以 `read_file` 工具为例，看看从函数定义到 Schema 的完整转换过程：

```python
# 函数定义
def read_file(
    path: Annotated[str, Field(description="要读取的文件路径")],
    offset: Annotated[int, Field(description="起始行号（从 1 开始）")] = 1,
    limit: Annotated[int, Field(description="最多读取的行数")] = 200,
) -> str:
    """读取指定文件的内容。支持通过 offset 和 limit 分段读取大文件。"""
    ...
```

经过 `_build_params_model` 处理后，会生成如下 Pydantic 模型：

```python
class read_file_Params(BaseModel):
    path: Annotated[str, Field(description="要读取的文件路径")]
    offset: Annotated[int, Field(description="起始行号（从 1 开始）")] = 1
    limit: Annotated[int, Field(description="最多读取的行数")] = 200
```

调用 `model_json_schema()` 后导出的 JSON Schema 大致为：

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "要读取的文件路径" },
    "offset": { "type": "integer", "description": "起始行号（从 1 开始）", "default": 1 },
    "limit": { "type": "integer", "description": "最多读取的行数", "default": 200 }
  },
  "required": ["path"]
}
```

这里 `Annotated[str, Field(description="...")]` 的用法是关键——`Annotated` 允许在类型注解中附加元数据，`Field(description="...")` 提供了参数的自然语言描述。这些描述最终会出现在 JSON Schema 中，帮助 LLM 理解每个参数的含义。

### OpenAI Schema 导出

`to_openai_schema` 方法将工具的完整信息组装为 OpenAI Chat Completions API 要求的格式：

```python
def to_openai_schema(self) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters_schema,
        },
    }
```

### 工具调用

`invoke` 方法负责用 LLM 返回的参数执行工具函数，中间通过 Pydantic 模型进行参数校验：

```python
def invoke(self, arguments: dict[str, Any]) -> Any:
    validated = self._params_model(**arguments)
    return self.func(**validated.model_dump())
```

这里先将参数传入 Pydantic 模型进行校验和类型转换（如将字符串 `"1"` 转为整数 `1`），再将校验后的值传给实际函数。如果参数不合法（缺少必填字段、类型不匹配等），Pydantic 会抛出 `ValidationError`，这个异常会被 `ToolManager.dispatch` 捕获并作为错误信息返回给 LLM。

## ToolManager

`ToolManager` 在[基础篇 3](/posts/agent-dev-basis-3)中的基础上增加了权限控制，是工具系统的中枢。

### 注册与装饰器

ToolManager 提供了两种注册方式——直接注册 `Tool` 实例，或通过装饰器注册函数：

```python
def register(self, tool: Tool) -> None:
    if tool.name in self._tools:
        raise ValueError(f"工具 '{tool.name}' 已存在")
    self._tools[tool.name] = tool
    if tool.permission != PermissionLevel.DANGEROUS:
        self._enabled.add(tool.name)

def tool(self, _func=None, *, name=None, description=None,
         permission=PermissionLevel.SAFE):
    def decorator(func):
        self.register(Tool(func, name=name, description=description,
                           permission=permission))
        return func
    return decorator(_func) if _func is not None else decorator
```

`register` 的逻辑是：注册工具，然后根据权限等级决定是否默认启用。DANGEROUS 工具默认不加入 `_enabled` 集合，其他等级的工具默认启用。

装饰器 `tool` 支持两种用法——这个 `_func` 参数的技巧在[基础篇 3](/posts/agent-dev-basis-3)中已经详细解释过：

```python
# 无参装饰器
@manager.tool
def read_file(path: str) -> str: ...

# 带参装饰器
@manager.tool(permission=PermissionLevel.SENSITIVE)
def write_file(path: str, content: str) -> str: ...
```

### 权限检查与派发

`dispatch` 方法是工具调用的入口，也是权限控制的执行点：

```python
def dispatch(self, name: str, arguments: str | dict[str, Any]) -> Any:
    if name not in self._tools:
        raise KeyError(f"未注册的工具：{name}")

    tool = self._tools[name]
    if isinstance(arguments, str):
        arguments = json.loads(arguments or "{}")

    # 启用检查
    if name not in self._enabled:
        return (
            f"[工具未启用] 工具 '{name}' 当前处于禁用状态。"
            f"权限等级: {tool.permission.value}，"
            f"需要通过 /tool enable {name} 手动启用。"
        )

    # 权限审批
    if tool.permission == PermissionLevel.SENSITIVE:
        if name not in self._auto_approved:
            if self._confirm_callback is None:
                return f"[权限拒绝] 工具 '{name}' 需要人工确认，但未设置确认回调。"
            decision = self._confirm_callback(name, tool.description, arguments)
            if decision is False:
                return f"[权限拒绝] 用户拒绝了工具 '{name}' 的执行请求。"
            if decision == "always":
                self._auto_approved.add(name)

    return tool.invoke(arguments)
```

这段代码的关键设计点在[进阶篇 4](/posts/agent-dev-advanced-4)中已经介绍过，这里补充几个实现细节：

1. **权限拒绝以字符串形式返回**，而不是抛出异常。这使得拒绝结果可以作为普通的 Observation 进入 ReAct 循环，LLM 能看到拒绝原因并调整策略（例如改用其他工具或向用户解释为什么需要该权限）。

2. **`_confirm_callback` 的三值返回**。返回 `True` 表示一次性允许，`"always"` 表示会话级自动批准（之后不再弹出确认），`False` 表示拒绝。这个设计让用户在首次确认时就能决定后续的审批策略。

3. **`arguments` 兼容字符串和字典**。LLM 返回的 `arguments` 通常是 JSON 字符串，但在某些场景下已经被提前解析为字典。`dispatch` 方法对两种输入格式都能处理。

### 会话级自动批准

`_auto_approved` 集合实现了"始终允许"功能。当用户对某个 SENSITIVE 工具选择"始终允许"后，该工具名被加入 `_auto_approved`，后续调用时跳过确认步骤。

```python
def approve_tool(self, name: str) -> None:
    if name in self._tools:
        self._auto_approved.add(name)

def reset_approvals(self) -> None:
    self._auto_approved.clear()
```

`reset_approvals` 在新建会话或切换会话时调用，确保自动批准不会跨会话泄露——用户在上一个会话中授予的"始终允许"不应该在新会话中继续生效。

## 内置工具

ToyCoder 的内置工具分为四组，每组通过一个 `register_*_tools` 函数批量注册到 ToolManager。

### 文件操作工具

文件操作是 Coding Agent 最核心的能力。ToyCoder 提供了四个文件工具：

**`read_file`** — 读取文件内容。支持 `offset` 和 `limit` 参数实现分页读取，输出格式为 `行号: 内容`：

```python
@manager.tool(permission=PermissionLevel.SAFE)
def read_file(
    path: Annotated[str, Field(description="要读取的文件路径")],
    offset: Annotated[int, Field(description="起始行号（从 1 开始）")] = 1,
    limit: Annotated[int, Field(description="最多读取的行数")] = 200,
) -> str:
    """读取指定文件的内容。支持通过 offset 和 limit 分段读取大文件。"""
    p = Path(path).resolve()
    if not p.exists():
        return f"[错误] 文件不存在: {path}"
    # ... 读取并格式化 ...
    lines = p.read_text(encoding="utf-8").splitlines()
    total = len(lines)
    start = max(0, offset - 1)
    end = min(total, start + limit)
    selected = lines[start:end]
    result_lines = [f"{i + start + 1}: {line}" for i, line in enumerate(selected)]
    header = f"[文件: {path} | 行 {start + 1}-{end}/{total}]"
    return header + "\n" + "\n".join(result_lines)
```

分页读取的设计至关重要——对于大文件（如几千行的代码文件），一次性读取会占用大量 Token。通过 `offset` 和 `limit`，LLM 可以先读取文件的前 200 行了解结构，再根据需要定位到特定区域深入阅读。

输出中的 `行号: 内容` 格式不仅便于 LLM 理解文件结构，更重要的是为 `edit_file` 提供了行号参考——LLM 可以说"请将第 42 行的 xxx 替换为 yyy"。

**`edit_file`** — 精确字符串替换。要求 `old_string` 在文件中唯一匹配：

```python
@manager.tool(permission=PermissionLevel.SENSITIVE)
def edit_file(
    path: Annotated[str, Field(description="要编辑的文件路径")],
    old_string: Annotated[str, Field(description="要被替换的原始文本")],
    new_string: Annotated[str, Field(description="替换后的新文本")],
) -> str:
    """在文件中执行精确的字符串替换。old_string 必须在文件中唯一匹配。"""
    # ...
    count = text.count(old_string)
    if count == 0:
        return "[错误] 未找到要替换的文本"
    if count > 1:
        return f"[错误] 找到 {count} 处匹配，请提供更多上下文使其唯一"
    new_text = text.replace(old_string, new_string, 1)
    p.write_text(new_text, encoding="utf-8")
    return f"[成功] 已替换文本 ({len(old_string)} -> {len(new_string)} 字符)"
```

"唯一匹配"的约束是刻意的安全设计——如果 `old_string` 在文件中出现多次，替换哪一处是模糊的。强制要求唯一匹配迫使 LLM 提供足够多的上下文来精确定位要修改的位置，从而避免误改。

**`write_file`** — 创建或覆盖文件，标记为 SENSITIVE：

```python
@manager.tool(permission=PermissionLevel.SENSITIVE)
def write_file(
    path: Annotated[str, Field(description="要写入的文件路径")],
    content: Annotated[str, Field(description="要写入的文件内容")],
) -> str:
    """将内容写入指定文件。如果文件不存在会自动创建，如果存在会覆盖。"""
    p = Path(path).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return f"[成功] 已写入文件: {path} ({len(content)} 字符)"
```

`p.parent.mkdir(parents=True, exist_ok=True)` 自动创建父目录——当 LLM 需要创建 `src/utils/helpers.py` 时，`src/utils/` 目录会自动创建，不需要先执行 `mkdir` 命令。

### 搜索工具

**`glob_search`** — 按文件名模式搜索：

```python
@manager.tool(permission=PermissionLevel.SAFE)
def glob_search(
    pattern: Annotated[str, Field(description="glob 模式，如 '**/*.py'")],
    path: Annotated[str, Field(description="搜索的根目录")] = ".",
) -> str:
    """按文件名模式搜索文件。返回匹配的文件路径列表。"""
    matches = sorted(p.glob(pattern))
    files = [str(m.relative_to(p)) for m in matches if m.is_file()]
    # 截断过多结果
    max_results = 50
    if len(files) > max_results:
        files = files[:max_results]
    return header + "\n" + "\n".join(f"  {f}" for f in files)
```

**`grep_search`** — 按正则表达式搜索文件内容：

```python
@manager.tool(permission=PermissionLevel.SAFE)
def grep_search(
    pattern: Annotated[str, Field(description="正则表达式搜索模式")],
    path: Annotated[str, Field(description="搜索的根目录")] = ".",
    include: Annotated[str, Field(description="文件过滤模式，如 '*.py'")] = "*",
) -> str:
    """在文件内容中搜索匹配正则表达式的行。"""
    skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox"}
    # ...
```

搜索工具中有几个值得注意的设计：
- **结果截断**（`max_results = 50`）。避免搜索结果过多占用大量 Token。
- **跳过特定目录**（`.git`、`node_modules` 等）。这些目录中的文件对代码理解没有帮助，跳过它们可以大幅提高搜索速度。
- **相对路径输出**。搜索结果使用相对路径，比绝对路径更简洁且可移植。

### Shell 命令工具

```python
@manager.tool(permission=PermissionLevel.DANGEROUS)
def run_command(
    command: Annotated[str, Field(description="要执行的 Shell 命令")],
    workdir: Annotated[str, Field(description="工作目录（可选）")] = ".",
    timeout: Annotated[int, Field(description="超时时间（秒）")] = 30,
) -> str:
    """在 Shell 中执行命令并返回输出。"""
    result = subprocess.run(
        command, shell=True, cwd=workdir,
        capture_output=True, text=True, timeout=timeout,
    )
    # ... 合并 stdout/stderr，截断过长输出 ...
```

`run_command` 被标记为 `DANGEROUS` 是理所当然的——它可以执行任意 Shell 命令，包括 `rm -rf /` 这样的毁灭性操作。默认禁用，用户必须通过 `/tool enable run_command` 手动启用。

实现中的安全措施包括：
- **超时限制**（默认 30 秒），防止命令无限期挂起。
- **输出截断**（最多 10000 字符），防止大量输出占用 Token。
- **stdout/stderr 合并**，确保 LLM 能看到完整的执行结果（包括错误信息）。

### 用户交互工具

```python
_ask_user_callback: Callable[[str, list[str]], str] | None = None

def set_ask_user_callback(callback: Callable[[str, list[str]], str]) -> None:
    global _ask_user_callback
    _ask_user_callback = callback

def register_question_tools(manager: ToolManager) -> None:
    @manager.tool(permission=PermissionLevel.SAFE)
    def ask_user(
        question: Annotated[str, Field(description="要向用户提出的问题")],
        options: Annotated[list[str], Field(description="可选项列表")] = [],
    ) -> str:
        """向用户提问并等待回答。"""
        if _ask_user_callback is None:
            return "[错误] 用户交互回调未设置"
        answer = _ask_user_callback(question, options)
        return f"用户回答: {answer}"
```

`ask_user` 的设计比较特殊——它是一个反向交互工具。通常是用户向 Agent 发消息，但 `ask_user` 让 Agent 能主动向用户提问。

模块级 `_ask_user_callback` 的使用是因为工具函数需要通过装饰器注册，无法方便地在构造时传入回调。通过模块级变量 + setter 函数的方式，在 `app.py` 初始化时设置回调，工具函数在执行时读取回调。这不是最优雅的方式（全局状态），但在这个场景下是最简单实用的方案。

## MCP 工具适配器

MCP（Model Context Protocol）工具适配器将外部 MCP Server 提供的工具"伪装"为本地 `Tool`，使得 `ToolManager` 可以用完全相同的方式管理本地工具和 MCP 工具。

```python
class MCPTool(Tool):
    def __init__(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        session: Any,  # mcp.ClientSession
        permission: PermissionLevel = PermissionLevel.SAFE,
    ) -> None:
        # 跳过父类的函数签名解析，直接设置属性
        self.name = name
        self.description = description
        self._input_schema = input_schema
        self._session = session
        self.permission = permission
        self.func = None
        self._params_model = None
```

`MCPTool` 继承自 `Tool` 但**跳过了父类的构造函数**——因为 MCP 工具没有本地函数，不需要从函数签名解析 Schema。它的 Schema 直接来自 MCP Server 返回的 `inputSchema`。

`invoke` 方法通过 MCP 协议远程调用工具：

```python
def invoke(self, arguments: dict[str, Any]) -> Any:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result = pool.submit(
                asyncio.run, self._session.call_tool(self.name, arguments=arguments)
            ).result()
    else:
        result = asyncio.run(
            self._session.call_tool(self.name, arguments=arguments)
        )

    texts = [c.text for c in result.content if hasattr(c, "text")]
    return "\n".join(texts) if texts else str(result.content)
```

这里有一个异步兼容的技巧：MCP 的 `call_tool` 是异步方法，但 `Tool.invoke` 被同步的 `ToolManager.dispatch` 调用。代码先检测是否已有运行中的事件循环——如果有（比如在异步上下文中），则使用线程池避免嵌套事件循环的问题；如果没有，则直接用 `asyncio.run` 执行。

`load_mcp_tools` 函数负责连接 MCP Server 并批量注册工具：

```python
async def load_mcp_tools(manager, server_params, exit_stack):
    transport = await exit_stack.enter_async_context(stdio_client(server_params))
    read_stream, write_stream = transport
    session = await exit_stack.enter_async_context(
        ClientSession(read_stream, write_stream)
    )
    await session.initialize()

    tools_response = await session.list_tools()
    for tool_info in tools_response.tools:
        mcp_tool = MCPTool(
            name=tool_info.name,
            description=tool_info.description or "",
            input_schema=tool_info.inputSchema,
            session=session,
        )
        manager.register(mcp_tool)
    return session
```

这个函数的设计在[进阶篇 1](/posts/agent-dev-advanced-1)中已有介绍。值得注意的是 `exit_stack` 参数——它管理 MCP 连接的生命周期，确保在应用退出时正确关闭所有连接。

## 小结

`tool/` 模块的设计可以用三个词概括：**自动化、安全性、可扩展性**。

- **自动化**：`Tool` 基类从函数签名自动生成 Schema，开发者只需要写好类型注解和 docstring，不需要手工维护 JSON Schema。
- **安全性**：三级权限模型确保了不同风险等级的操作有不同的审批策略，DANGEROUS 工具默认禁用防止意外执行。
- **可扩展性**：通过 `MCPTool` 适配器，外部工具可以无缝接入；通过装饰器注册模式，添加新的内置工具只需要写一个函数并加上装饰器。

下一篇将介绍 `agent/` 模块——ReAct 循环引擎和 SubAgent 的实现。

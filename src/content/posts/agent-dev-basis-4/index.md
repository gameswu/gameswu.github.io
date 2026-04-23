---
title: 古明地觉谈 Agent 应用 - 基础篇 4
description: 介绍 Prompt 的管理和书写方法
date: '2026-04-23'
order: 3
tags: [Agent, AI, 技术, Prompt]
cover: ./cover.png
prev: agent-dev-basis-3
---

在前面的文章中，我们已经介绍了 Agent 的基本开发方法。接下来，我们将深入探讨 Prompt 的管理和书写方法，这对于构建高效的 Agent 至关重要。

## Prompt 的管理

在开始介绍 Prompt 的书写方法之前，笔者想先介绍一下 Prompt 的管理方法。在笔者看来，Prompt 算是一种资源文件，不应当直接写在代码里，而是应该单独存放，并提供一个 Manager 来管理它们。

### Prompt 文件的存放

首先，Prompt 本身采用哪种格式存放都是可以的，无论是 JSON, YAML 甚至是纯文本都可以，重要的是要有一个统一的存放位置，便于管理和维护。笔者通常采用 YAML 格式来存放 Prompt，因为它具有良好的可读性和结构化的特点。

因为一个 Agent 应用中实际上可能存在多个 Agent，或者单个 Agent 在不同的场景下需要使用不同的 Prompt，所以我们可以按照功能或者场景来划分 Prompt 文件，并利用 YAML 的层级结构来组织它们并记录一些元信息。

笔者以一个简化的审题 Agent 应用[^ai-reviewer]为例，展示如何利用 YAML 来存放 Prompt：

[^ai-reviewer]: 参考了 [CPHOS AI Reviewer](https://github.com/CPHOS/AI_Reviewer)的实现，进行了简化和改编。

```yaml
# prompts/templates/review_point.yaml

point_reviewer:
    provider: xxx # 该 Agent 使用的 LLM 提供商
    model: xxx # 该 Agent 使用的 LLM 模型
    description: 该 Agent 用于审核得分点的正确性以及难度
    system: |
        你是一位资深的物理竞赛命题审核专家，精通理论物理、数学推导和竞赛命题规范。
        你的任务是对一道物理竞赛题目的某个小问中的所有评分点进行批量审核。

        ## 审核维度
        1. **正确性**
            - 数学运算是否正确
            - 物理图像是否合理
            - 判定：correct / minor_issue / wrong

        2. **难度**
            评估选手得到该评分点的难度

            | 分数 | 特征 | 示例 |
            | --- | --- | --- |
            | 1 | 直接套用公式结论，或者简单的数值计算 | 直接套用动能定理计算动能 |
            | 2 | 需要进行简单的物理分析，或者需要进行较为复杂的数值计算 | 需要分析受力情况，或者需要进行积分计算 |
            | 3 | 需要进行较为复杂的物理分析，或者需要进行较为复杂的数学推导 | 需要分析受力情况并且进行积分计算，或者需要进行较为复杂的数学推导 |

        ## 输出格式

        对每个评分点，用 `<review>` 标签包裹输出，格式如下。评分点数量必须与输入完全一致，顺序对应：
        <review tag="评分点编号" correctness="correct / minor_issue / wrong" difficulty="1 / 2 / 3">
        评语
        </review>

    user: |
        ## 题目信息

        ### 题干
        {statement}

        ### 解答上下文
        {context}

        ### 已审核结果
        {reviewed_points}

        ### 待审核评分点，共 {num_points} 个
        {points_to_review}

        请对以上 {num_points} 个评分点逐一进行审核，按照系统提示的格式输出。
```

### Prompt Manager 的实现

笔者这里提供一个简单的 Prompt Manager 的实现示例，来展示如何加载和管理 Prompt 文件：

```python
# prompt/manager.py
from pathlib import Path
from typing import Any, Dict
import yaml

_TEMPLATE_DIR = Path(__file__).parent / 'templates'

class PromptManager:
    def __init__(self):
        self.prompts: Dict[str, Dict[str, Any]] = {}

    def load_prompt(self, name: str) -> Dict[str, Any]:
        if name in self.prompts:
            return self.prompts[name]

        prompt_path = _TEMPLATE_DIR / f'{name}.yaml'
        if not prompt_path.exists():
            raise FileNotFoundError(f'Prompt file {prompt_path} not found.')

        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_data = yaml.safe_load(f)

        self.prompts[name] = prompt_data
        return prompt_data

    def render(self, name:str, **variables: str) -> list[dict[str, str]]:
        prompt_data = self.load_prompt(name)
        system = prompt_data['system'].format(**variables)
        user = prompt_data['user'].format(**variables)
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]
```

上面的 `PromptManager` 类提供了一个简单的接口来加载 Prompt 文件并渲染成 LLM 可用的消息格式。通过调用 `render` 方法，我们可以将 Prompt 模板中的变量替换成实际的值，从而生成最终的 Prompt。

## Prompt 的书写方法

笔者首先介绍 Prompt 的书写原则：
1. 专一性：Prompt 应该针对特定的任务或者场景进行设计，避免过于泛化。对于 System Prompt 来说，应该明确 Agent 的角色、能力和限制；对于 User Prompt 来说，应该清晰地描述任务的输入和输出要求。
2. 结构化：Prompt 应该具有清晰的结构，便于 LLM 理解和处理。可以利用标题、列表、表格等方式来组织信息，使得 Prompt 更加易读和易于解析。

首先，对于 System Prompt 来说可以按照如下模板来书写：

```markdown
你是一位{角色描述}，具备{能力描述}，但有以下限制：{限制描述}。
你的任务是{任务描述}，请按照以下要求完成：

## 任务描述
{任务具体描述}

## 输出格式
{输出格式要求}
```

具体的任务描述中，笔者建议根据实际情况设计指标，并且在提示词中提供明确的评判标准以及示例，以便 LLM 能够更好地理解任务要求并生成符合预期的输出。

对于 User Prompt 来说，可以按照如下模板来书写：

```markdown
## 输入信息
{输入信息描述}

## 任务要求
{任务具体要求}
```

另外就是如前述示例中的 Prompt 模板一样，可以在 Prompt 中提供一些输入信息的占位符，这些占位符在实际使用时会被替换成具体的值，从而生成最终的 Prompt。
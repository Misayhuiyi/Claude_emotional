# 算法题记录

## 1. 两数之和

**题目：** 找到数组中两个数之和为目标值的下标。

**解法：** 哈希表（O(n)）

```python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        if target - num in seen:
            return [seen[target - num], i]
        seen[num] = i
```

## 2. 有效的括号

**题目：** 判断括号字符串是否有效匹配。

**解法：** 栈（O(n)）

```python
def is_valid(s: str) -> bool:
    stack = []
    pairs = {')': '(', ']': '[', '}': '{'}
    for c in s:
        if c in '({[':
            stack.append(c)
        else:
            if not stack or stack[-1] != pairs[c]:
                return False
            stack.pop()
    return len(stack) == 0
```

**核心思路：** 遇到左括号入栈，遇到右括号检查栈顶是否匹配。

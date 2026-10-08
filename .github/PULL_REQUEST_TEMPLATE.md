## 改了什么

（一句话；关联 Issue 号）

## 为什么

（动机 / 依据：PRTS 原文、官方数据、上游变更、实机现象）

## 怎么验证

- [ ] `node --test --test-concurrency=3`（或说明只跑了哪些文件）
- [ ] `npx.cmd eslint .` / `tsc --noEmit --checkJs` / `node tools/check-imports.mjs` 全绿
- [ ] `node tools/golden.mjs`：**零差异**，或差异逐场景解释如下
- [ ] 观感类改动：附真浏览器/真对局证据（截图或日志）
- [ ] 新增行为有回归测试（并说明它在改动前会失败）

## 红线自查

- [ ] 未提交任何官方素材
- [ ] 非商业、保留署名与许可
- [ ] 若推翻了历史裁定，已在 Issue 中给出新证据
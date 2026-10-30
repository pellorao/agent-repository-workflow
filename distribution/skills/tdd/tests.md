# 好测试与坏测试

## Good Tests

**集成风格**: 通过真实的 Interface 测试, 不 mock 内部部分.

```typescript
// GOOD: 测试可观察的行为
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

特征:

- 测试用户/调用方关心的行为
- 只使用公开 API
- 经得起内部重构
- 描述做什么 (WHAT), 不描述怎么做 (HOW)
- 每个测试一个逻辑断言

## Bad Tests

**实现细节测试**: 与内部结构耦合.

```typescript
// BAD: 测试实现细节
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

危险信号:

- mock 内部协作者
- 测试私有方法
- 对调用次数/顺序做断言
- 重构时测试坏了, 行为却没变
- 测试名称描述的是怎么做 (HOW), 不是做什么 (WHAT)
- 通过外部手段验证, 而不是通过 Interface

```typescript
// BAD: 绕过 Interface 验证
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// GOOD: 通过 Interface 验证
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

**同义反复的测试**: 期望值复述了实现, 所以测试天然通过.

```typescript
// BAD: 期望值按代码的计算方式重新计算
test("calculateTotal sums line items", () => {
  const items = [{ price: 10 }, { price: 5 }];
  const expected = items.reduce((sum, i) => sum + i.price, 0);
  expect(calculateTotal(items)).toBe(expected);
});

// GOOD: 期望值是独立的, 已知的字面量
test("calculateTotal sums line items", () => {
  expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
});
```

# V54 品項層級已取貨

- `order_items` 新增 `picked_up_qty`、`picked_up_at`、`picked_up_by_uid`。
- 只有正式、非封存、非取消、非現貨的預購品項可以標記取貨。
- 已取貨數量不可超過 `min(arrived_qty, qty - released_qty)`。
- 已取貨不修改原始銷售額、成本、供應商付款或庫存流水。
- 未出貨報表會扣除已取貨數量；整個品項都已取貨時，該品項不再出現在待出貨明細。
- 可取消已取貨標記，取消後品項重新出現在未出貨報表。
- 沿用既有 `/api/neon-orders-runtime`，不新增 Serverless Function。

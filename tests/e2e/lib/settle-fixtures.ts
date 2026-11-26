export const TANGLED_SETTLE = `export function settle(order) {
  if (order !== null) {
    if (order.paid || order.credit) {
      for (const line of order.lines) {
        if (line.taxable && line.shipped || line.gift) {
          charge(line);
        } else if (line.refunded || line.voided) {
          refund(line);
        } else {
          skip(line);
        }
      }
      return "settled";
    }
    return "unpaid";
  }
  return "missing";
}
`;

export const FLAT_SETTLE = `export function settle(order) {
  if (order === null) return "missing";
  if (!order.paid) return "unpaid";
  for (const line of order.lines) {
    if (line.taxable) charge(line);
  }
  return "settled";
}
`;

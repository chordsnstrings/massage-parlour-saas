// `warehouse` namespace (EN source, R9). Only the warehouse screen edits this file; mirror every key in th/warehouse.ts.
export const warehouse = {
  title: 'Warehouse',
  description:
    'Central stock for the whole spa. Receive purchases here, then transfer to branches as they need it.',
  location: { warehouse: 'Warehouse' },
  stat: {
    stocked: 'Products in the warehouse',
    low: 'Low in the warehouse',
    value: 'Warehouse value',
  },
  empty: {
    title: 'No products yet',
    body: 'Add products under Inventory, then record purchases into the warehouse.',
  },
  col: { warehouse: 'Warehouse', branches: 'At branches' },
  transfer: {
    title: 'Transfer {name}',
    body: 'Moves stock between the warehouse and a branch. Both sides are recorded; the stock value stays the same.',
    submit: 'Transfer',
    button: 'Transfer',
    direction: 'Direction',
    out: 'Warehouse → branch',
    in: 'Branch → warehouse',
    branch: 'Branch',
    qty: 'Quantity ({unit})',
    onHand: 'In the warehouse: {qty}',
    note: 'Note',
    sent: '{qty} sent to the branch',
    returned: '{qty} returned to the warehouse',
  },
  count: {
    title: 'Count {name} in the warehouse',
    body: 'Enter what is on the shelf. The difference is recorded and valued at cost.',
  },
  low: {
    title: 'Low-stock level for {name}',
    body: 'Warn when the warehouse holds this much or less. Leave empty to use the product’s own level.',
    button: 'Low level',
    label: 'Warn at ({unit})',
    productDefault: 'Product level: {qty}',
    none: 'The product has no low-stock level',
    saved: 'Low-stock level saved',
  },
  moves: {
    title: 'Warehouse activity',
    sub: 'Purchases, counts and transfers',
    empty: 'Nothing has moved yet.',
  },
  v: {
    branch: 'Choose a branch',
    qty: 'Enter a quantity above zero',
    low: 'Enter zero or more',
  },
} as const

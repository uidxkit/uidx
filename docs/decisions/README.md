# Architecture decisions

Each record settles one question about the format or its tools and says why.
They are numbered in the order they were decided. A later record that amends
or supersedes an earlier one says so at its top, and the table says so here.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-node-addressing.md) | Node addressing resolves §3.4 | Superseded by 0003 |
| [0002](0002-fidelity-to-figma-and-css.md) | The authored surface tracks Figma and CSS, not the scene graph | Accepted |
| [0003](0003-page-root-and-two-level-addressing.md) | `<Page>` is the root, and addresses gain a component segment | Accepted; amended by 0004, 0008 and 0009 |
| [0004](0004-global-document-namespace.md) | One global namespace per document; a file is a page | Accepted; amends 0003 |
| [0005](0005-variants.md) | Variants: one component, declared axes, full trees | Accepted; amended by 0016 |
| [0006](0006-images-and-vector-artwork.md) | Artwork: rasters are referenced, vectors are inlined and authored, reuse is a component | Accepted |
| [0007](0007-slots.md) | Slots: a component declares a hole, a consumer fills it | Accepted; amended by 0010 |
| [0008](0008-component-is-a-frame.md) | A `<Component>` is a frame, not a wrapper around one | Accepted; amends 0003 |
| [0009](0009-status-is-optional.md) | `status` is optional, and unstated means undeclared | Accepted; amends 0003 |
| [0010](0010-a-slot-may-be-a-components-direct-child.md) | A `<Slot>` may be a `<Component>`'s direct child | Accepted; amends 0007 |
| [0011](0011-pins-a-child-states-its-offset.md) | A pinned child states its offset, not its coordinate | Accepted |
| [0012](0012-design-system-model.md) | The design system model: identity, contract, behaviour; components are renders | Accepted; umbrella for 0013–0018; amended by 0018 |
| [0013](0013-component-contract.md) | The component contract region | Accepted; part of 0012 |
| [0014](0014-behavior-guidelines.md) | Behaviour guidelines: prose with ids, traced to tests | Accepted; part of 0012 |
| [0015](0015-models-and-examples.md) | Models declare inputs; examples are sample scenes | Accepted; part of 0012 |
| [0016](0016-variants-as-renders.md) | Variants are renders: axes from the contract, a styles table, authored trees only for structure | Accepted; part of 0012; amends 0005 |
| [0017](0017-collections-and-code-targets.md) | Collections, and code as a render target | Accepted; part of 0012 |
| [0018](0018-instance-box-overrides.md) | An instance is a black box with a styleable outer box | Accepted; part of 0012; amends 0012 §1 and §4 |

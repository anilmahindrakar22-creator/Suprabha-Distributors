# Pricing recovery — 16 October 2026

Owner reports missing United Diagnostics prices and inability to approve pricing. Codex is investigating and integrating; instrument setup writes are paused.

## Verified diagnosis

- Production holds 1,520 Tally sales-price records and 2,319 purchase-cost records. The stored sales-price evidence spans 15 August–16 October 2026; this is not a full-history certification. Approved customer contracts and base prices each have zero records.
- United Diagnostics Services has 64 imported price records, yielding 31 purchased product rows: 28 ready and three requiring review. The real Administrator screen displays these prices.
- Its packed orders SF-261016-00047 / 00048 request Uniplastin 12x5 Ml / Qualisa HIV 4.0. Neither item has a customer-specific selling price in the imported history. Latest purchase costs are INR404.67 / INR1,700. The resolver explicitly returns `NO_ELIGIBLE_PRICE_HISTORY`; there is no approved base/contract or target margin to supply a rate. Other customers' rates are not valid substitutes.
- A read-only search of all six retained April–September native Tally exports found 31 United Diagnostics vouchers and **zero lines for either exact ordered item**. This does not certify older years or later source changes. Evidence: `work/pricing-recovery-20261016/united-retained-history.json`. Use the existing bounded parser; a direct XML cast fails on Tally's undeclared UDF namespace and can echo the full source in an exception. No fresh Tally request or import was performed.
- Production logged an `Order has changed; refresh before trying again` rejection at 07:39:55 UTC. Both United orders advanced around that time. The order price-review component retains its earlier workspace when only the order version changes and offers no reload control. This establishes a stale-pricing defect, although the owner's exact failing control/message has also been requested.
- The top Pricing Refresh button refreshes contracts/policies but does not reload the selected customer book. A new regression fails against the original source because its displayed price stays unchanged after Refresh.

## Implemented locally

1. `components/pricing-workspace.tsx`: manual Refresh invalidates the in-memory master request cache and triggers a selected-book refresh while preserving customer selection.
2. `components/customer-price-book.tsx`: selection/search guidance, explicit no-match/loading states, retry customer/product list, and retry prices without reopening Pricing.
3. `components/pricing-options.tsx`: when no proposed/continuity/recommended rate exists, show a compact form containing purchase cost, agreed selling rate and reason. Omit unavailable recommendation fields and disabled recommendation choices. No price is guessed or automatically approved.
4. `tests/pricing-browser/price-book.spec.ts` and `tests/ui/main.tsx`: regressions for these flows and the no-history fixture; existing authorization-loss, uncertain-save/idempotency and approval tests remain.

## Order review correction — takeover authorized

The owner explicitly authorized Codex to take over price review after the shared handover reserved the broader Orders file for Claude's `claude/order-next-step` work. Scope is limited to `PricingPanel` and its render location in `OrderCard`; stage/dispatch/navigation work is retained. The owner clarified that the approval section was not visible.

`components/order-workspace.tsx` now exposes a separate **Review pricing** disclosure immediately below the stage action, outside generic order details. Price evidence loads on demand; closing/reopening keeps the existing component and unsaved entries. Existing financial-role and pre-billing-status visibility rules are unchanged. The component adds Reload pricing, prevents submission against a known older order version, retains unsaved rates/reasons until explicit reload, disables edits during load/save, and discards the old governed command reference after successfully loading new evidence. Server version/evidence/margin/role checks remain intact. No approval is automatically resubmitted.

`tests/pricing-browser/order-pricing-recovery.spec.ts` exercises the visible direct pricing action without opening generic order details, lazy evidence loading, preservation across disclosure close/reopen, a live order-version change, and recovery from an initial pricing read failure on desktop and phone.

The four isolated proposal checks passed, along with four existing cross-session/order-draft checks. The live-change regression fails against the original order component (stale pricing warning absent), establishing that it detects the missing behavior. Final combined verification includes the new direct-action rendering.

## Verification and release state

- Original Refresh regression fails as expected; corrected implementation passes.
- All 56 combined pricing/order browser checks pass (desktop and mobile), including the direct pricing action, access revocation, existing lost-response receipts, cross-session updates and unsaved order drafts.
- 26 affected unit checks pass. Full project lint and staff-production build passed for the initial five-file patch. Final combined components pass focused lint and isolated typecheck; exact-source release CI/build remains required.
- An initial browser run found four ambiguous test locators after a nested alert markup change; restoring a single alert paragraph resolved them. Final full 48-case run passes. Lint's semantic-status finding was corrected using `output`.
- Additional keyboard/recovery suite: 24 PASS (four overlap combined checks). Final compact no-history form and draft/reload cases: six PASS. Phone rendering inspected from the isolated test screenshot `work/pricing-recovery-20261016/exact/test-results/pricing-review-mobile.png`.
- No deployment, migration, financial approval, pricing import, Tally write or role change has been performed for this correction. All unrelated dirty work is retained. Screenshots of the live app were unavailable through the current browser connection; DOM and database evidence were available.

## Next step

Finish combined verification, reconcile Claude's latest handover, then release the reviewed UI correction through the normal exact-source checks. The two United order rates still require genuine historical evidence or a staff-entered agreed rate with a reason. Do not invent a price to make an approval button succeed.

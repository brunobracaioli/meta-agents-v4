"use client";

// SPEC-019 — stable import path for consuming the ARC Render Bus. Re-exports the context
// hook so panels and the (future) voice/gesture bridges depend on `use-render-bus`, not on
// the provider module's internals.
export { useRenderBusContext as useRenderBus, type RenderBusValue } from "./render-bus";

import { Reference, createConstRef } from '@glimmer/reference';
import { DirtyableTag, createTag, dirtyTag, consumeTag } from '@glimmer/validator';
import {
  Dict,
  Option,
  Bounds,
  CapturedNamedArguments,
  ComponentManager,
  WithJitStaticLayout,
  JitRuntimeResolver,
  AotRuntimeResolver,
  WithAotStaticLayout,
  ComponentCapabilities,
  Environment,
  VMArguments,
  DynamicScope,
  CompilableProgram,
  Invocation,
  Destroyable,
} from '@glimmer/interfaces';
import { keys, assign, unwrapTemplate } from '@glimmer/util';
import { BASIC_CAPABILITIES } from './capabilities';
import { TestComponentDefinitionState } from './test-component';
import { TestComponentConstructor } from './types';
import { EmberishCurlyComponentFactory } from './emberish-curly';
import { registerDestructor, reifyNamed } from '@glimmer/runtime';

export type Attrs = Dict;
export type AttrsDiff = { oldAttrs: Option<Attrs>; newAttrs: Attrs };
export type EmberishGlimmerArgs = { attrs: Attrs };

export class EmberishGlimmerComponent {
  public dirtinessTag: DirtyableTag = createTag();
  public attrs!: Attrs;
  public element!: Element;
  public bounds!: Bounds;
  public parentView: Option<EmberishGlimmerComponent> = null;

  static create({ attrs: args }: EmberishGlimmerArgs): EmberishGlimmerComponent {
    let c = new this({ attrs: args });

    for (let key of keys(args)) {
      (c as any)[key] = args[key];
    }

    return c;
  }

  constructor(_args: EmberishGlimmerArgs) {}

  recompute() {
    dirtyTag(this.dirtinessTag);
  }

  destroy() {}

  didInitAttrs(_options: { attrs: Attrs }) {}
  didUpdateAttrs(_diff: AttrsDiff) {}
  didReceiveAttrs(_diff: AttrsDiff) {}
  willInsertElement() {}
  willUpdate() {}
  willRender() {}
  didInsertElement() {}
  didUpdate() {}
  didRender() {}
  willDestroyElement() {}
}

export interface EmberishGlimmerComponentFactory
  extends TestComponentConstructor<EmberishGlimmerComponent> {
  create(options: { attrs: Attrs }): EmberishGlimmerComponent;
  new (...args: unknown[]): this;
}

export const EMBERISH_GLIMMER_CAPABILITIES = assign({}, BASIC_CAPABILITIES, {
  dynamicTag: true,
  createArgs: true,
  attributeHook: true,
  updateHook: true,
  createInstance: true,
});

export interface EmberishGlimmerComponentState {
  args: CapturedNamedArguments;
  component: EmberishGlimmerComponent;
  selfRef: Reference;
}

export class EmberishGlimmerComponentManager
  implements
    ComponentManager<EmberishGlimmerComponentState, TestComponentDefinitionState>,
    WithJitStaticLayout<
      EmberishGlimmerComponentState,
      TestComponentDefinitionState,
      JitRuntimeResolver
    >,
    WithAotStaticLayout<
      EmberishGlimmerComponentState,
      TestComponentDefinitionState,
      AotRuntimeResolver
    > {
  getCapabilities(state: TestComponentDefinitionState): ComponentCapabilities {
    return state.capabilities;
  }

  getDebugName(state: TestComponentDefinitionState) {
    return state.name;
  }

  prepareArgs(): null {
    return null;
  }

  create(
    _env: Environment,
    definition: TestComponentDefinitionState,
    _args: VMArguments,
    _dynamicScope: DynamicScope,
    _callerSelf: Reference<unknown>,
    _hasDefaultBlock: boolean
  ): EmberishGlimmerComponentState {
    let args = _args.named.capture();
    let klass = definition.ComponentClass || EmberishGlimmerComponent;
    let attrs = reifyNamed(args);
    let component = klass.create({ attrs });

    component.didInitAttrs({ attrs });
    component.didReceiveAttrs({ oldAttrs: null, newAttrs: attrs });
    component.willInsertElement();
    component.willRender();

    registerDestructor(component, () => component.destroy());

    consumeTag(component.dirtinessTag);

    let selfRef = createConstRef(component, 'this');

    return { args, component, selfRef };
  }

  getJitStaticLayout(
    state: TestComponentDefinitionState,
    resolver: JitRuntimeResolver
  ): CompilableProgram {
    return unwrapTemplate(resolver.compilable(state.locator)).asLayout();
  }

  getAotStaticLayout(
    state: TestComponentDefinitionState,
    resolver: AotRuntimeResolver
  ): Invocation {
    let { locator } = state;

    return resolver.getInvocation(locator);
  }

  getSelf({ selfRef }: EmberishGlimmerComponentState): Reference<unknown> {
    return selfRef;
  }

  didCreateElement(): void {}

  didRenderLayout({ component }: EmberishGlimmerComponentState, bounds: Bounds): void {
    component.bounds = bounds;
  }

  didCreate({ component }: EmberishGlimmerComponentState): void {
    component.didInsertElement();
    registerDestructor(component, () => component.willDestroyElement(), true);

    component.didRender();
  }

  update({ args, component }: EmberishGlimmerComponentState): void {
    let oldAttrs = component.attrs;
    let newAttrs = reifyNamed(args);

    component.attrs = newAttrs;
    component.didUpdateAttrs({ oldAttrs, newAttrs });
    component.didReceiveAttrs({ oldAttrs, newAttrs });
    component.willUpdate();
    component.willRender();

    consumeTag(component.dirtinessTag);
  }

  didUpdateLayout(): void {}

  didUpdate({ component }: EmberishGlimmerComponentState): void {
    component.didUpdate();
    component.didRender();
  }

  getDestroyable({ component }: EmberishGlimmerComponentState): Destroyable {
    return component;
  }
}

export interface ComponentHooks {
  didInitAttrs: number;
  didUpdateAttrs: number;
  didReceiveAttrs: number;
  willInsertElement: number;
  willUpdate: number;
  willRender: number;
  didInsertElement: number;
  didUpdate: number;
  didRender: number;
}

export interface HookedComponent {
  hooks: ComponentHooks;
}

export function inspectHooks<
  T extends EmberishCurlyComponentFactory | EmberishGlimmerComponentFactory
>(ComponentClass: T): T {
  return (class extends (ComponentClass as any) {
    constructor() {
      super();

      (this as any).hooks = {
        didInitAttrs: 0,
        didUpdateAttrs: 0,
        didReceiveAttrs: 0,
        willInsertElement: 0,
        willUpdate: 0,
        willRender: 0,
        didInsertElement: 0,
        didUpdate: 0,
        didRender: 0,
      };
    }

    didInitAttrs(this: any) {
      super.didInitAttrs(...arguments);
      this.hooks['didInitAttrs']++;
    }

    didUpdateAttrs(this: any) {
      super.didUpdateAttrs(...arguments);
      this.hooks['didUpdateAttrs']++;
    }

    didReceiveAttrs(this: any) {
      super.didReceiveAttrs(...arguments);
      this.hooks['didReceiveAttrs']++;
    }

    willInsertElement(this: any) {
      super.willInsertElement(...arguments);
      this.hooks['willInsertElement']++;
    }

    willUpdate(this: any) {
      super.willUpdate(...arguments);
      this.hooks['willUpdate']++;
    }

    willRender(this: any) {
      super.willRender(...arguments);
      this.hooks['willRender']++;
    }

    didInsertElement(this: any) {
      super.didInsertElement(...arguments);
      this.hooks['didInsertElement']++;
    }

    didUpdate(this: any) {
      super.didUpdate(...arguments);
      this.hooks['didUpdate']++;
    }

    didRender(this: any) {
      super.didRender(...arguments);
      this.hooks['didRender']++;
    }
  } as any) as T;
}

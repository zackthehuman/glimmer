import {
  Bounds,
  WithJitStaticLayout,
  WithAotStaticLayout,
  AotRuntimeResolver,
  JitRuntimeResolver,
  Environment,
  CompilableProgram,
  Invocation,
  ComponentCapabilities,
} from '@glimmer/interfaces';
import { TestComponentDefinitionState } from './test-component';
import { unreachable, expect, unwrapTemplate } from '@glimmer/util';
import { Reference, createConstRef } from '@glimmer/reference';

export interface BasicComponentFactory {
  new (): BasicComponent;
}

export class BasicComponent {
  public element!: Element;
  public bounds!: Bounds;
}

export class BasicComponentManager
  implements
    WithJitStaticLayout<BasicComponent, TestComponentDefinitionState, JitRuntimeResolver>,
    WithAotStaticLayout<BasicComponent, TestComponentDefinitionState, AotRuntimeResolver> {
  getCapabilities(state: TestComponentDefinitionState): ComponentCapabilities {
    return state.capabilities;
  }

  prepareArgs(): null {
    throw unreachable();
  }

  create(_env: Environment, definition: TestComponentDefinitionState): BasicComponent {
    let klass = definition.ComponentClass || BasicComponent;
    return new klass();
  }

  getDebugName(state: TestComponentDefinitionState) {
    return state.name;
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
    // For the case of dynamically invoking (via `{{component}}`) in eager
    // mode, we need to exchange the module locator for the handle to the
    // compiled layout (which was provided at bundle compilation time and
    // stashed in the component definition state).
    let locator = expect(state.locator, 'component definition state should include module locator');
    return resolver.getInvocation(locator);
  }

  getSelf(component: BasicComponent): Reference {
    return createConstRef(component, 'this');
  }

  didCreateElement(component: BasicComponent, element: Element): void {
    component.element = element;
  }

  didRenderLayout(component: BasicComponent, bounds: Bounds): void {
    component.bounds = bounds;
  }

  didCreate(): void {}

  update(): void {}

  didUpdateLayout(): void {}

  didUpdate(): void {}

  getDestroyable(): null {
    return null;
  }
}

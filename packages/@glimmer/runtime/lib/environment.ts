import { DEBUG } from '@glimmer/env';
import {
  Environment,
  EnvironmentOptions,
  GlimmerTreeChanges,
  GlimmerTreeConstruction,
  Transaction,
  TransactionSymbol,
  CompilerArtifacts,
  WithCreateInstance,
  ResolvedValue,
  RuntimeResolverDelegate,
  ModifierManager,
  Template,
  AotRuntimeResolver,
  Invocation,
  JitRuntimeContext,
  AotRuntimeContext,
  JitRuntimeResolver,
  SyntaxCompilationContext,
  RuntimeConstants,
  RuntimeHeap,
  Macros,
  Option,
  CompileTimeConstants,
  CompileTimeHeap,
  WholeProgramCompilationContext,
} from '@glimmer/interfaces';
import { assert, expect, symbol, debugToString } from '@glimmer/util';
import { track, updateTag } from '@glimmer/validator';
import { DOMChangesImpl, DOMTreeConstruction } from './dom/helper';
import { RuntimeProgramImpl } from '@glimmer/program';

export const TRANSACTION: TransactionSymbol = symbol('TRANSACTION');

class TransactionImpl implements Transaction {
  public scheduledInstallManagers: ModifierManager[] = [];
  public scheduledInstallModifiers: unknown[] = [];
  public scheduledUpdateModifierManagers: ModifierManager[] = [];
  public scheduledUpdateModifiers: unknown[] = [];
  public createdComponents: unknown[] = [];
  public createdManagers: WithCreateInstance<unknown>[] = [];
  public updatedComponents: unknown[] = [];
  public updatedManagers: WithCreateInstance<unknown>[] = [];

  didCreate(component: unknown, manager: WithCreateInstance) {
    this.createdComponents.push(component);
    this.createdManagers.push(manager);
  }

  didUpdate(component: unknown, manager: WithCreateInstance) {
    this.updatedComponents.push(component);
    this.updatedManagers.push(manager);
  }

  scheduleInstallModifier(modifier: unknown, manager: ModifierManager) {
    this.scheduledInstallModifiers.push(modifier);
    this.scheduledInstallManagers.push(manager);
  }

  scheduleUpdateModifier(modifier: unknown, manager: ModifierManager) {
    this.scheduledUpdateModifiers.push(modifier);
    this.scheduledUpdateModifierManagers.push(manager);
  }

  commit() {
    let { createdComponents, createdManagers } = this;

    for (let i = 0; i < createdComponents.length; i++) {
      let component = createdComponents[i];
      let manager = createdManagers[i];
      manager.didCreate(component);
    }

    let { updatedComponents, updatedManagers } = this;

    for (let i = 0; i < updatedComponents.length; i++) {
      let component = updatedComponents[i];
      let manager = updatedManagers[i];
      manager.didUpdate(component);
    }

    let { scheduledInstallManagers, scheduledInstallModifiers } = this;

    let manager: ModifierManager, modifier: unknown;

    for (let i = 0; i < scheduledInstallManagers.length; i++) {
      modifier = scheduledInstallModifiers[i];
      manager = scheduledInstallManagers[i];

      let modifierTag = manager.getTag(modifier);

      if (modifierTag !== null) {
        let tag = track(
          // eslint-disable-next-line no-loop-func
          () => manager.install(modifier),
          DEBUG &&
            `- While rendering:\n\n  (instance of a \`${manager.getDebugName(modifier)}\` modifier)`
        );
        updateTag(modifierTag, tag);
      } else {
        manager.install(modifier);
      }
    }

    let { scheduledUpdateModifierManagers, scheduledUpdateModifiers } = this;

    for (let i = 0; i < scheduledUpdateModifierManagers.length; i++) {
      modifier = scheduledUpdateModifiers[i];
      manager = scheduledUpdateModifierManagers[i];

      let modifierTag = manager.getTag(modifier);

      if (modifierTag !== null) {
        let tag = track(
          // eslint-disable-next-line no-loop-func
          () => manager.update(modifier),
          DEBUG && `While rendering an instance of a \`${debugToString!(modifier)}\` modifier`
        );
        updateTag(modifierTag, tag);
      } else {
        manager.update(modifier);
      }
    }
  }
}

export class EnvironmentImpl<Extra> implements Environment<Extra> {
  [TRANSACTION]: Option<TransactionImpl> = null;

  protected appendOperations!: GlimmerTreeConstruction;
  protected updateOperations?: GlimmerTreeChanges;

  // Delegate methods and values
  public extra = this.delegate.extra;
  public isInteractive = this.delegate.isInteractive;

  constructor(options: EnvironmentOptions, private delegate: EnvironmentDelegate<Extra>) {
    if (options.appendOperations) {
      this.appendOperations = options.appendOperations;
      this.updateOperations = options.updateOperations;
    } else if (options.document) {
      this.appendOperations = new DOMTreeConstruction(options.document);
      this.updateOperations = new DOMChangesImpl(options.document);
    } else if (DEBUG) {
      throw new Error('you must pass document or appendOperations to a new runtime');
    }
  }

  getAppendOperations(): GlimmerTreeConstruction {
    return this.appendOperations;
  }

  getDOM(): GlimmerTreeChanges {
    return expect(
      this.updateOperations,
      'Attempted to get DOM updateOperations, but they were not provided by the environment. You may be attempting to rerender in an environment which does not support rerendering, such as SSR.'
    );
  }

  begin() {
    assert(
      !this[TRANSACTION],
      'A glimmer transaction was begun, but one already exists. You may have a nested transaction, possibly caused by an earlier runtime exception while rendering. Please check your console for the stack trace of any prior exceptions.'
    );

    this.delegate.onTransactionBegin();

    this[TRANSACTION] = new TransactionImpl();
  }

  private get transaction(): TransactionImpl {
    return expect(this[TRANSACTION]!, 'must be in a transaction');
  }

  didCreate(component: unknown, manager: WithCreateInstance) {
    this.transaction.didCreate(component, manager);
  }

  didUpdate(component: unknown, manager: WithCreateInstance) {
    this.transaction.didUpdate(component, manager);
  }

  scheduleInstallModifier(modifier: unknown, manager: ModifierManager) {
    if (this.isInteractive) {
      this.transaction.scheduleInstallModifier(modifier, manager);
    }
  }

  scheduleUpdateModifier(modifier: unknown, manager: ModifierManager) {
    if (this.isInteractive) {
      this.transaction.scheduleUpdateModifier(modifier, manager);
    }
  }

  commit() {
    let transaction = this.transaction;
    this[TRANSACTION] = null;
    transaction.commit();

    this.delegate.onTransactionCommit();
  }
}

export interface EnvironmentDelegate<Extra = undefined> {
  /**
   * Used to determine the the environment is interactive (e.g. SSR is not
   * interactive). Interactive environments schedule modifiers, among other things.
   */
  isInteractive: boolean;

  /**
   * Slot for any extra values that the embedding environment wants to add,
   * providing/passing around additional context to various users in the VM.
   */
  extra: Extra;

  /**
   * Callback to be called when an environment transaction begins
   */
  onTransactionBegin: () => void;

  /**
   * Callback to be called when an environment transaction commits
   */
  onTransactionCommit: () => void;
}

export class DefaultRuntimeResolver<R> implements JitRuntimeResolver<R>, AotRuntimeResolver {
  constructor(private inner: RuntimeResolverDelegate<R>) {}

  lookupComponent(name: string, referrer?: R): Option<any> {
    if (this.inner.lookupComponent) {
      let component = this.inner.lookupComponent(name, referrer);

      if (component === undefined) {
        throw new Error(
          `Unexpected component ${name} (from ${referrer}) (lookupComponent returned undefined)`
        );
      }

      return component;
    } else {
      throw new Error('lookupComponent not implemented on RuntimeResolver.');
    }
  }

  lookupPartial(name: string, referrer?: R): Option<number> {
    if (this.inner.lookupPartial) {
      let partial = this.inner.lookupPartial(name, referrer);

      if (partial === undefined) {
        throw new Error(
          `Unexpected partial ${name} (from ${referrer}) (lookupPartial returned undefined)`
        );
      }

      return partial;
    } else {
      throw new Error('lookupPartial not implemented on RuntimeResolver.');
    }
  }

  resolve<U extends ResolvedValue>(handle: number): U {
    if (this.inner.resolve) {
      let resolved = this.inner.resolve(handle);

      if (resolved === undefined) {
        throw new Error(`Unexpected handle ${handle} (resolve returned undefined)`);
      }

      return resolved as U;
    } else {
      throw new Error('resolve not implemented on RuntimeResolver.');
    }
  }

  compilable(locator: R): Template {
    if (this.inner.compilable) {
      let resolved = this.inner.compilable(locator);

      if (resolved === undefined) {
        throw new Error(`Unable to compile ${name} (compilable returned undefined)`);
      }

      return resolved;
    } else {
      throw new Error('compilable not implemented on RuntimeResolver.');
    }
  }

  getInvocation(locator: R): Invocation {
    if (this.inner.getInvocation) {
      let invocation = this.inner.getInvocation(locator);

      if (invocation === undefined) {
        throw new Error(
          `Unable to get invocation for ${JSON.stringify(
            locator
          )} (getInvocation returned undefined)`
        );
      }

      return invocation;
    } else {
      throw new Error('getInvocation not implemented on RuntimeResolver.');
    }
  }
}

export function AotRuntime(
  options: EnvironmentOptions,
  program: CompilerArtifacts,
  resolver: RuntimeResolverDelegate = {},
  delegate: EnvironmentDelegate
): AotRuntimeContext {
  let env = new EnvironmentImpl(options, delegate);

  return {
    env,
    resolver: new DefaultRuntimeResolver(resolver),
    program: RuntimeProgramImpl.hydrate(program),
  };
}

export interface JitProgramCompilationContext extends WholeProgramCompilationContext {
  readonly constants: CompileTimeConstants & RuntimeConstants;
  readonly heap: CompileTimeHeap & RuntimeHeap;
}

export interface JitSyntaxCompilationContext extends SyntaxCompilationContext {
  readonly program: JitProgramCompilationContext;
  readonly macros: Macros;
}

export function JitRuntime<R, E>(
  options: EnvironmentOptions,
  delegate: EnvironmentDelegate<E>,
  context: JitSyntaxCompilationContext,
  resolver: RuntimeResolverDelegate<R> = {}
): JitRuntimeContext<R, E> {
  return {
    env: new EnvironmentImpl(options, delegate),
    program: new RuntimeProgramImpl(context.program.constants, context.program.heap),
    resolver: new DefaultRuntimeResolver(resolver),
  };
}

export function inTransaction(env: Environment, cb: () => void): void {
  if (!env[TRANSACTION]) {
    env.begin();
    try {
      cb();
    } finally {
      env.commit();
    }
  } else {
    cb();
  }
}

export default EnvironmentImpl;

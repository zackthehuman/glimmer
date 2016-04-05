import { Dict, LinkedList, LinkedListNode, Slice, initializeGuid,  } from 'glimmer-util';
import { RevisionTag } from 'glimmer-reference';
import { VM, UpdatingVM } from './vm';

export interface OpcodeJSON {
  guid: number;
  type: string;
  args?: string[];
  details?: Dict<string>;
  children?: OpcodeJSON[];
}

export abstract class UpdatingOpcode implements LinkedListNode {
  tag: RevisionTag;
  type: string;
  next: Opcode = null;
  prev: Opcode = null;

  public _guid: number;

  constructor() {
    initializeGuid(this);
  }

  abstract evaluate(vm: UpdatingVM);

  toJSON(): OpcodeJSON {
    return { guid: this._guid, type: this.type };
  }
}

export type UpdatingOpSeq = Slice<UpdatingOpcode>;

interface OpcodeFactory<T extends Opcode> {
  new(options: T): T;
}

export abstract class Opcode implements LinkedListNode {
  type: string;
  next: Opcode = null;
  prev: Opcode = null;

  public _guid: number;

  constructor() {
    initializeGuid(this);
  }

  abstract evaluate(vm: VM);

  toJSON(): OpcodeJSON {
    return { guid: this._guid, type: this.type };
  }
}

export type OpSeq = Slice<Opcode>;
export type OpSeqBuilder = LinkedList<Opcode>;

/**
 * A forward-only cursor over an ArrayBuffer with little-endian readers and
 * bounds checking. Used by the binary format parsers (.3d, later .lox).
 */

export class ByteCursorError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (at byte offset ${offset})`);
    this.name = "ByteCursorError";
  }
}

const utf8 = new TextDecoder("utf-8");

export class ByteCursor {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  pos = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  get length(): number {
    return this.bytes.length;
  }

  atEnd(): boolean {
    return this.pos >= this.bytes.length;
  }

  remaining(): number {
    return this.bytes.length - this.pos;
  }

  private ensure(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new ByteCursorError(
        `Unexpected end of file: needed ${n} more byte(s)`,
        this.pos,
      );
    }
  }

  u8(): number {
    this.ensure(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.ensure(1);
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.ensure(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.ensure(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Read `n` raw bytes, advancing the cursor. */
  take(n: number): Uint8Array {
    this.ensure(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Skip `n` bytes. */
  skip(n: number): void {
    this.ensure(n);
    this.pos += n;
  }

  /**
   * Read raw bytes up to (and consuming) the next LF (0x0A), returning the
   * bytes BEFORE the LF. A trailing CR (0x0D) before the LF is dropped.
   * Throws if no LF is found before end of file.
   */
  lineBytes(): Uint8Array {
    const start = this.pos;
    while (this.pos < this.bytes.length) {
      if (this.bytes[this.pos] === 0x0a) {
        let end = this.pos;
        if (end > start && this.bytes[end - 1] === 0x0d) end -= 1;
        const out = this.bytes.subarray(start, end);
        this.pos += 1; // consume the LF
        return out;
      }
      this.pos += 1;
    }
    throw new ByteCursorError("Expected a line terminated by LF", start);
  }

  /** Like {@link lineBytes} but decoded as UTF-8. */
  line(): string {
    return utf8.decode(this.lineBytes());
  }
}

export function decodeUtf8(bytes: Uint8Array | number[]): string {
  return utf8.decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
}

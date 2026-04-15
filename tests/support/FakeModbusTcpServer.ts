import net from 'node:net';

export class FakeModbusTcpServer {
  private readonly server = net.createServer(socket => {
    this.sockets.add(socket);

    let buffer = Buffer.alloc(0);

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      void this.handleFrames(socket, () => {
        const length = buffer.length >= 6 ? 6 + buffer.readUInt16BE(4) : Number.POSITIVE_INFINITY;
        if (buffer.length < length) {
          return null;
        }

        const frame = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        return frame;
      });
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
    });
  });

  private readonly registers = new Map<number, Map<number, number>>();

  private readonly sockets = new Set<net.Socket>();

  private nextDropCount = 0;

  public async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    return (this.server.address() as net.AddressInfo).port;
  }

  public async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  public seedRegisters(unitId: number, values: Record<number, number>): void {
    const registerMap = this.registers.get(unitId) ?? new Map<number, number>();
    for (const [address, value] of Object.entries(values)) {
      registerMap.set(Number(address), value);
    }
    this.registers.set(unitId, registerMap);
  }

  public getRegister(unitId: number, address: number): number {
    return this.registers.get(unitId)?.get(address) ?? 0;
  }

  public dropNextRequests(count: number): void {
    this.nextDropCount = count;
  }

  private async handleFrames(socket: net.Socket, getFrame: () => Buffer | null): Promise<void> {
    let frame: Buffer | null;
    while ((frame = getFrame())) {
      if (this.nextDropCount > 0) {
        this.nextDropCount -= 1;
        socket.destroy();
        return;
      }

      const transactionId = frame.readUInt16BE(0);
      const unitId = frame.readUInt8(6);
      const functionCode = frame.readUInt8(7);

      if (functionCode === 3) {
        const address = frame.readUInt16BE(8);
        const count = frame.readUInt16BE(10);
        const payload = Buffer.alloc(2 + count * 2);
        payload.writeUInt8(3, 0);
        payload.writeUInt8(count * 2, 1);

        for (let index = 0; index < count; index += 1) {
          payload.writeUInt16BE(this.getRegister(unitId, address + index), 2 + index * 2);
        }

        socket.write(this.buildResponse(transactionId, unitId, payload));
        continue;
      }

      if (functionCode === 6) {
        const address = frame.readUInt16BE(8);
        const value = frame.readUInt16BE(10);
        const unitRegisters = this.registers.get(unitId) ?? new Map<number, number>();
        unitRegisters.set(address, value);
        this.registers.set(unitId, unitRegisters);
        socket.write(this.buildResponse(transactionId, unitId, frame.subarray(7, 12)));
        continue;
      }

      socket.destroy(new Error(`Unsupported function code ${functionCode}.`));
      return;
    }
  }

  private buildResponse(transactionId: number, unitId: number, payload: Buffer): Buffer {
    const response = Buffer.alloc(7 + payload.length);
    response.writeUInt16BE(transactionId, 0);
    response.writeUInt16BE(0, 2);
    response.writeUInt16BE(payload.length + 1, 4);
    response.writeUInt8(unitId, 6);
    payload.copy(response, 7);
    return response;
  }
}

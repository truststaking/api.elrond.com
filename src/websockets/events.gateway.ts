import { Injectable } from "@nestjs/common";
import { WebSocketServer } from "@nestjs/websockets";
import { Server } from 'socket.io'

@Injectable()
// @WebSocketGateway(3003)
export class EventsGateway {
  @WebSocketServer()
  server: Server | undefined

  onAccountBalanceChanged(account: string) {
    console.log(`publishing websocket event balanceChanged:${account}`);

    this.server?.emit(`balanceChanged:${account}`); 
  }
}
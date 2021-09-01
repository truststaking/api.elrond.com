import { ApiProperty } from '@nestjs/swagger';
import { SmartContractResult } from './smart.contract.result';
import { TransactionDetailed } from './transaction.detailed';
import { TransactionPoint, TransactionType } from './transaction.status';

export class TransactionLabeled extends TransactionDetailed {
  @ApiProperty({ type: TransactionType })
  type: TransactionType | undefined = undefined;
  @ApiProperty({ type: TransactionPoint })
  points: TransactionPoint | undefined = undefined;
  @ApiProperty({ type: String })
  method: string | undefined = undefined;
}
export class TransactionHistory {
  @ApiProperty({ type: TransactionType })
  type: TransactionType | undefined = undefined;

  @ApiProperty({ type: TransactionPoint })
  points: TransactionPoint | undefined = undefined;

  @ApiProperty()
  txHash = '';

  @ApiProperty()
  receiver = '';

  @ApiProperty()
  sender = '';

  @ApiProperty()
  value = '';

  @ApiProperty()
  fee = '';

  @ApiProperty()
  timestamp = 0;

  @ApiProperty()
  data = '';

  @ApiProperty()
  price: number | undefined = undefined;

  @ApiProperty({ type: String })
  method: string | undefined = undefined;

  @ApiProperty({ type: SmartContractResult, isArray: true })
  scResults: SmartContractResult[] = [];

  getDate(): Date | undefined {
    if (this.timestamp) {
      return new Date(this.timestamp * 1000);
    }

    return undefined;
  }
}

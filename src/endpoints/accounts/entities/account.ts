import { ApiProperty } from '@nestjs/swagger';

export class Account {
  @ApiProperty({ description: 'The address of the account' })
  address = '';

  @ApiProperty({
    description:
      'The current balance of the account (must be denominated to obtain the real value)',
  })
  balance = '';

  @ApiProperty({ description: 'The current nonce of the account' })
  nonce = '';

  @ApiProperty({ description: 'The shard identifier of the account' })
  shard = 0;
}

export class AccountHistory {
  @ApiProperty({ description: 'The balance of the account per epoch' })
  balanceHistory = [];
  @ApiProperty({ description: 'The actions of the account' })
  actionTypes = [];
  @ApiProperty({ description: 'The top senders of the account' })
  topSenders = [];
  @ApiProperty({ description: 'The top receivers of the account' })
  topReceivers = [];
  @ApiProperty({ description: 'The creation date of the account' })
  addressCreatedAt = '';
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { TransactionService } from 'src/endpoints/transactions/transaction.service';
import { AccountService } from 'src/endpoints/accounts/account.service';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  getEpoch,
  getProfile,
  getTimestampByEpoch,
  db,
} from 'src/utils/trust.utils';
@Injectable()
export class ElrondTaxService {
  private readonly logger: Logger;

  constructor(
    private readonly transactionService: TransactionService,
    private readonly accountService: AccountService,
    @Inject('PUBSUB_SERVICE') private clientProxy: ClientProxy,
  ) {
    this.logger = new Logger(ElrondTaxService.name);
  }
  @Cron('* * * * * *')
  async update_average_apy(agency: string) {

    const params = {
      TableName: 'AVGAPY',
      KeyConditionExpression: 'provider = :agency AND epoch > 250',
      ExpressionAttributeNames: {
        '#time': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':ep': { S: agency },
      },
    };
    const result = await db.send(new QueryCommand(params));
    const a = 10;
    // const transactions = await this.accountService.getAccountHistory({
    //   sender: address,
    //   receiver: address,
    //   senderShard,
    //   receiverShard,
    //   miniBlockHash,
    //   status,
    //   search,
    //   condition,
    //   before,
    //   after,
    //   from,
    //   size,
    // });
  }
}
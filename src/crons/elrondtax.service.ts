import { Injectable } from '@nestjs/common'; //  Logger  Inject,
// import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { ProviderService} from 'src/endpoints/providers/provider.service';
import { AccountService, getAgencyOwner } from 'src/endpoints/accounts/account.service';
// import { TransactionService } from 'src/endpoints/transactions/transaction.service';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  // getEpoch,
  // getProfile,
  // getTimestampByEpoch,
  db,
} from 'src/utils/trust.utils';

@Injectable()
export class ElrondTaxService {
  // private readonly logger: Logger;

  constructor(
    private readonly accountService: AccountService,
    private readonly providerService: ProviderService,
  //   // private readonly transactionService: TransactionService,
  //   // private readonly accountService: AccountService,
  //   @Inject('PUBSUB_SERVICE') private clientProxy: ClientProxy,
  ) {
  //   // this.logger = new Logger(ElrondTaxService.name);
  }
  @Cron('*/5 * * * * *')
  async update_average_apy() {
    
    var providers = await this.providerService.getProviderAddresses();
    providers.forEach( async provider => {
      var reply = await this.update_agency_apy(provider);
      console.log(reply);
    });
    
  }
  async update_agency_apy(agency: string) {

    const params = {
      TableName: 'avg_apy',
      KeyConditionExpression: '#pr = :agency AND #ep > :phase3',
      ExpressionAttributeNames:{
        "#pr": "provider",
        "#ep": "epoch"
      },
      ExpressionAttributeValues: {
        ':agency': { S: agency },
        ':phase3': { N: '250'},
      },
      ScanIndexForward: false,
    };
    const result = await db.send(new QueryCommand(params));
    try {
      if (!result.Items || result.Items.length == 0) {
        this.calculate_average_apy({ agency: agency });
        console.log(result.Items);
      }
      else {
        var daily_apys = result.Items.map(function (item) { return Number(item.daily_apy.S); })
        this.calculate_average_apy({ agency: agency , daily_apys: daily_apys});

      }
    } catch (error) {
      console.log('error');
    }
    return result;
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

  async calculate_average_apy({ agency, daily_apys = [], start_epoch = 250 }: {agency: string, daily_apys?: number[], start_epoch?: number }) {

    var owner = await getAgencyOwner(agency);
    console.log(daily_apys);
    console.log(start_epoch);
    if (!owner) {
      console.log("cannot find owner for address: " + agency);
      return
    }
    const transactions = await this.accountService.getAccountHistory({
      sender: owner,
      receiver: owner,
      senderShard: undefined,
      receiverShard: undefined,
      miniBlockHash: undefined,
      status: undefined,
      search: undefined,
      condition: undefined,
      before: undefined,
      after: undefined,
      from: 0,
      size: 10000,
    });
    if (transactions.length === 0) {
      return new History();
    }
    return await this.accountService.analyseTransactions(transactions, owner);
  }
}
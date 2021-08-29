import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ElasticService } from '../../common/elastic.service';
import { GatewayService } from '../../common/gateway.service';
import { AccountDetailed } from './entities/account.detailed';
import { Account } from './entities/account';
import { CachingService } from 'src/common/caching.service';
import { VmQueryService } from 'src/endpoints/vm.query/vm.query.service';
import { ApiConfigService } from 'src/common/api.config.service';
import { AccountDeferred } from './entities/account.deferred';
import { QueryPagination } from 'src/common/entities/query.pagination';
import { ElasticPagination } from 'src/common/entities/elastic/elastic.pagination';
import { ElasticSortProperty } from 'src/common/entities/elastic/elastic.sort.property';
import { ElasticSortOrder } from 'src/common/entities/elastic/elastic.sort.order';
import { ElasticQuery } from 'src/common/entities/elastic/elastic.query';
import { QueryType } from 'src/common/entities/elastic/query.type';
import { Constants } from 'src/utils/constants';
import { AddressUtils } from 'src/utils/address.utils';
import { ApiUtils } from 'src/utils/api.utils';
import { BinaryUtils } from 'src/utils/binary.utils';
import { TransactionService } from '../transactions/transaction.service';
import { TransactionFilter } from '../transactions/entities/transaction.filter';
import { TransactionStatus } from '../transactions/entities/transaction.status';
import { TransactionDetailed } from '../transactions/entities/transaction.detailed';
import { NumberUtils } from 'src/utils/number.utils';
import BigNumber from 'bignumber.js';

@Injectable()
export class AccountService {
  private readonly logger: Logger;

  constructor(
    private readonly elasticService: ElasticService,
    private readonly gatewayService: GatewayService,
    @Inject(forwardRef(() => CachingService))
    private readonly cachingService: CachingService,
    private readonly vmQueryService: VmQueryService,
    private readonly apiConfigService: ApiConfigService,
    private readonly transactionService: TransactionService,
  ) {
    this.logger = new Logger(AccountService.name);
  }

  async getHistory(filter: TransactionFilter): Promise<TransactionDetailed[]> {
    const getSendTransactions = await this.transactionService.getTransactions({
      ...filter,
      size: 10000,
      from: 0,
      status: TransactionStatus.success,
      receiver: undefined,
    });
    const getReceiveTransactions =
      await this.transactionService.getTransactions({
        ...filter,
        size: 10000,
        from: 0,
        status: TransactionStatus.success,
        sender: undefined,
      });
    const transactions: TransactionDetailed[] = [
      ...getSendTransactions,
      ...getReceiveTransactions,
    ];
    transactions.sort(function (
      a: { timestamp: number },
      b: { timestamp: number },
    ) {
      return a.timestamp - b.timestamp;
    });
    return transactions.map((tx) => {
      tx.value = NumberUtils.denominateFloat({ input: tx.value }).toString();
      tx.fee = NumberUtils.denominateFloat({ input: tx.fee }).toString();
      if (tx.scResults !== null) {
        for (let index = 0; index < tx.scResults.length; index++) {
          const scResult = tx.scResults[index];
          tx.scResults[index].value = NumberUtils.denominateFloat({
            input: tx.scResults[index].value,
          }).toString();
          if (scResult.data) {
            tx.scResults[index].data = Buffer.from(
              tx.scResults[index].data,
              'base64',
            ).toString();
            const data_list = tx.scResults[index].data.split('@');
            const data_list_hex: string[] = [];
            if (data_list.length > 1) {
              data_list.forEach((info, index) => {
                if (
                  index == 2 &&
                  (Buffer.from(tx.data, 'base64')
                    .toString()
                    .split('@')[0]
                    .localeCompare('createNewDelegationContract') == 0 ||
                    Buffer.from(tx.data, 'base64')
                      .toString()
                      .split('@')[0]
                      .localeCompare('makeNewContractFromValidatorData') ==
                      0) &&
                  info.includes('000000')
                ) {
                  data_list_hex.push(AddressUtils.bech32Encode(info));
                } else {
                  data_list_hex.push(Buffer.from(info, 'hex').toString());
                }
              });
            }
            tx.scResults[index].data = data_list_hex.join('@');
          }
        }
      }
      if (tx.data !== null) {
        tx.data = Buffer.from(tx.data, 'base64').toString();
        const values = tx.data.split('@');
        if (
          values[0] == 'unDelegate' ||
          (values[0] == 'unStake' &&
            tx.receiver ===
              'erd1qqqqqqqqqqqqqpgqxwakt2g7u9atsnr03gqcgmhcv38pt7mkd94q6shuwt')
        ) {
          values[1] = new BigNumber(values[1], 16).toString(10);
          values[1] = NumberUtils.denominateFloat({
            input: values[1],
          }).toString();
          tx.data = values.join('@');
        }
      }
      return tx;
    });
  }
  async getAccountsCount(): Promise<number> {
    return await this.cachingService.getOrSetCache(
      'account:count',
      async () => await this.elasticService.getCount('accounts'),
      Constants.oneMinute(),
    );
  }

  async getAccount(address: string): Promise<AccountDetailed | null> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();
    elasticQueryAdapter.condition.should = [
      QueryType.Match('sender', address),
      QueryType.Match('receiver', address),
    ];

    try {
      const [
        txCount,
        {
          account: { nonce, balance, code, codeHash, rootHash, username },
        },
      ] = await Promise.all([
        this.elasticService.getCount('transactions', elasticQueryAdapter),
        this.gatewayService.get(`address/${address}`),
      ]);

      const shard = AddressUtils.computeShard(
        AddressUtils.bech32Decode(address),
      );

      const result = {
        address,
        nonce,
        balance,
        code,
        codeHash,
        rootHash,
        txCount,
        username,
        shard,
      };

      return result;
    } catch (error) {
      this.logger.error(error);
      this.logger.error(
        `Error when getting account details for address '${address}'`,
      );
      return null;
    }
  }

  async getAccounts(queryPagination: QueryPagination): Promise<Account[]> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();

    const { from, size } = queryPagination;
    const pagination: ElasticPagination = {
      from,
      size,
    };
    elasticQueryAdapter.pagination = pagination;

    const balanceNum: ElasticSortProperty = {
      name: 'balanceNum',
      order: ElasticSortOrder.descending,
    };
    elasticQueryAdapter.sort = [balanceNum];

    const result = await this.elasticService.getList(
      'accounts',
      'address',
      elasticQueryAdapter,
    );

    const accounts: Account[] = result.map((item) =>
      ApiUtils.mergeObjects(new Account(), item),
    );
    for (const account of accounts) {
      account.shard = AddressUtils.computeShard(
        AddressUtils.bech32Decode(account.address),
      );
    }

    return accounts;
  }

  async getDeferredAccount(address: string): Promise<AccountDeferred[]> {
    const publicKey = AddressUtils.bech32Decode(address);

    const [
      encodedUserDeferredPaymentList,
      [encodedNumBlocksBeforeUnBond],
      {
        status: { erd_nonce: erdNonceString },
      },
    ] = await Promise.all([
      this.vmQueryService.vmQuery(
        this.apiConfigService.getDelegationContractAddress(),
        'getUserDeferredPaymentList',
        undefined,
        [publicKey],
      ),
      this.vmQueryService.vmQuery(
        this.apiConfigService.getDelegationContractAddress(),
        'getNumBlocksBeforeUnBond',
        undefined,
        [],
      ),
      this.gatewayService.get(
        `network/status/${this.apiConfigService.getDelegationContractShardId()}`,
      ),
    ]);

    const numBlocksBeforeUnBond = parseInt(
      this.decode(encodedNumBlocksBeforeUnBond),
    );
    const erdNonce = parseInt(erdNonceString);

    const data: AccountDeferred[] = encodedUserDeferredPaymentList.reduce(
      (result: AccountDeferred[], _, index, array) => {
        if (index % 2 === 0) {
          const [encodedDeferredPayment, encodedUnstakedNonce] = array.slice(
            index,
            index + 2,
          );

          const deferredPayment = this.decode(encodedDeferredPayment);
          const unstakedNonce = parseInt(this.decode(encodedUnstakedNonce));
          const blocksLeft = Math.max(
            0,
            unstakedNonce + numBlocksBeforeUnBond - erdNonce,
          );
          const secondsLeft = blocksLeft * 6; // 6 seconds per block

          result.push({ deferredPayment, secondsLeft });
        }

        return result;
      },
      [],
    );

    return data;
  }

  async getKeys(
    address: string,
  ): Promise<
    { blsKey: string; stake: string; status: string; rewardAddress: string }[]
  > {
    const publicKey = AddressUtils.bech32Decode(address);

    const BlsKeysStatus = await this.vmQueryService.vmQuery(
      this.apiConfigService.getAuctionContractAddress(),
      'getBlsKeysStatus',
      this.apiConfigService.getAuctionContractAddress(),
      [publicKey],
    );

    if (!BlsKeysStatus) {
      return [];
    }

    const queued: any = [];

    const data = BlsKeysStatus.reduce((result: any, _, index, array) => {
      if (index % 2 === 0) {
        const [encodedBlsKey, encodedStatus] = array.slice(index, index + 2);

        const blsKey = BinaryUtils.padHex(
          Buffer.from(encodedBlsKey, 'base64').toString('hex'),
        );
        const status = Buffer.from(encodedStatus, 'base64').toString();
        const stake = '2500000000000000000000';

        if (status === 'queued') {
          queued.push(blsKey);
        }

        result.push({ blsKey, stake, status });
      }
      return result;
    }, []);

    if (data && data[0] && data[0].blsKey) {
      const [encodedRewardsPublicKey] = await this.vmQueryService.vmQuery(
        this.apiConfigService.getStakingContractAddress(),
        'getRewardAddress',
        undefined,
        [data[0].blsKey],
      );

      const rewardsPublicKey = Buffer.from(
        encodedRewardsPublicKey,
        'base64',
      ).toString();
      const rewardAddress = AddressUtils.bech32Encode(rewardsPublicKey);

      for (const [index, _] of data.entries()) {
        data[index].rewardAddress = rewardAddress;
      }
    }

    if (queued.length) {
      const results = await Promise.all([
        this.vmQueryService.vmQuery(
          this.apiConfigService.getStakingContractAddress(),
          'getQueueSize',
        ),
        ...queued.map((blsKey: string) =>
          this.vmQueryService.vmQuery(
            this.apiConfigService.getStakingContractAddress(),
            'getQueueIndex',
            this.apiConfigService.getAuctionContractAddress(),
            [blsKey],
          ),
        ),
      ]);

      let queueSize = '0';
      results.forEach(([result], index) => {
        if (index === 0) {
          queueSize = Buffer.from(result, 'base64').toString();
        } else {
          const [found] = data.filter(
            (x: any) => x.blsKey === queued[index - 1],
          );

          found.queueIndex = Buffer.from(result, 'base64').toString();
          found.queueSize = queueSize;
        }
      });
    }

    return data;
  }

  decode(value: string): string {
    const hex = Buffer.from(value, 'base64').toString('hex');
    return BigInt(hex ? '0x' + hex : hex).toString();
  }
}

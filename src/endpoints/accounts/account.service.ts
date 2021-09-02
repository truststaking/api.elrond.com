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
import * as genesis from 'src/utils/genesis.json';
import * as nodeSetup from 'src/utils/nodeSetup.json';
import { AddressUtils } from 'src/utils/address.utils';
import { ApiUtils } from 'src/utils/api.utils';
import { BinaryUtils } from 'src/utils/binary.utils';
import { TransactionService } from '../transactions/transaction.service';
import { TransactionFilter } from '../transactions/entities/transaction.filter';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.status';
import { TransactionHistory } from '../transactions/entities/transaction.labels';
import { ApiProperty } from '@nestjs/swagger';
import BigNumber from 'bignumber.js';
import { NumberUtils } from 'src/utils/number.utils';

const db = new DynamoDBClient({ region: 'eu-west-1' });
interface Dictionary<T> {
  [Key: string]: T;
}
interface Genesis {
  [Key: string]: GenesisDetails;
}
interface GenesisDetails {
  balance: string;
  delegation: GenesisDelegation;
}
interface GenesisDelegation {
  address: string;
  value: string;
}
export class ActionTypes {
  @ApiProperty()
  incoming = 0;
  @ApiProperty()
  outgoing = 0;
  @ApiProperty()
  selfTransfer = 0;
  @ApiProperty()
  scCalls = 0;
}
export class BalanceHystory {
  @ApiProperty()
  incoming = 0;
  @ApiProperty()
  outgoing = 0;
  @ApiProperty()
  selfTransfer = 0;
  @ApiProperty()
  scCalls = 0;
}
export class History {
  @ApiProperty()
  createdAt: Date | undefined = new Date();
  @ApiProperty()
  accountAge = 0;
  @ApiProperty()
  fees = new BigNumber(0);
  @ApiProperty({ type: ActionTypes })
  actionTypes: ActionTypes = new ActionTypes();
  @ApiProperty()
  balanceHistory: Dictionary<BigNumber> = {};
  @ApiProperty()
  available: any = new BigNumber(0);
  @ApiProperty()
  genesisNodes = 0;
  @ApiProperty()
  genesisAmount: any = new BigNumber(0);
  @ApiProperty()
  countTx = 0;
  @ApiProperty()
  points = 50;
  @ApiProperty()
  topSenders: Dictionary<number> = {};
  @ApiProperty()
  staked: Dictionary<any> = {};
  @ApiProperty()
  unDelegated: Dictionary<any> = {};
  @ApiProperty()
  epochHistoryStaked: Dictionary<any> = {};
  @ApiProperty()
  topReceivers: Dictionary<number> = {};
  @ApiProperty()
  topCalls: Dictionary<number> = {};
  @ApiProperty({ type: TransactionHistory, isArray: true })
  transactions: TransactionHistory[] | undefined = undefined;
}
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

  async getAccountHistory(
    filter: TransactionFilter,
  ): Promise<TransactionHistory[]> {
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
    const transactions: TransactionHistory[] = [
      ...getSendTransactions,
      ...getReceiveTransactions,
    ];
    transactions.sort(function (
      a: { timestamp: number },
      b: { timestamp: number },
    ) {
      return a.timestamp - b.timestamp;
    });
    removeDuplicate(transactions);
    return transactions;
  }
  async analyseTransactions(
    txs: TransactionHistory[],
    address: string,
  ): Promise<History> {
    const result = new History();
    const genesisData: Genesis = genesis;
    result.createdAt = txs[0].getDate();
    result.accountAge = daysSinceTime(
      txs[0].timestamp,
      new Date().getTime() / 1000,
    );
    result.countTx = txs.length;
    const firstWalletEpoch = getEpoch(txs[0].timestamp);
    const fetchPrice = [];
    if (address in genesisData) {
      result.points += 50;
      result.available = result.available.plus(
        new BigNumber(
          NumberUtils.denominateFloat(genesisData[address].balance),
        ),
      );
      result.genesisAmount = result.genesisAmount.plus(
        new BigNumber(
          NumberUtils.denominateFloat(genesisData[address].balance),
        ),
      );
      if (
        genesisData[address]['delegation'].address ===
        'erd1qqqqqqqqqqqqqpgqxwakt2g7u9atsnr03gqcgmhcv38pt7mkd94q6shuwt'
      ) {
        result.staked[genesisData[address].delegation.address] = new BigNumber(
          NumberUtils.denominateFloat(genesisData[address].delegation.value),
        );

        result.genesisAmount = result.genesisAmount.plus(
          new BigNumber(
            NumberUtils.denominateFloat(genesisData[address].delegation.value),
          ),
        );
      }
      for (const value of nodeSetup['initialNodes']) {
        if (value.address == address) {
          result.points += 25;
          result.genesisNodes += 1;
          if (
            result.staked[
              'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
            ]
          ) {
            result.staked[
              'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
            ] = result.staked[
              'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
            ].plus(new BigNumber(2500));
          } else {
            result.staked[
              'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
            ] = new BigNumber(2500);
          }

          result.genesisAmount = result.genesisAmount.plus(new BigNumber(2500));
        }
      }
    }
    result.genesisAmount = result.genesisAmount.toFixed();

    result.balanceHistory[1] = new BigNumber(result.genesisAmount);

    const todayEpoch = getEpoch(Math.floor(Date.now() / 1000));
    for (const tx of txs) {
      const epoch = getEpoch(tx.timestamp);
      const bigTxValue = new BigNumber(tx.value);
      let txFee = new BigNumber(0);
      // Calculate fees per wallet
      if (parseFloat(tx.fee) > 0 && tx.type !== TransactionType.receiver) {
        txFee = new BigNumber(tx.fee);
        result.fees = result.fees.plus(txFee);
        result.available = result.available.minus(txFee);
      }
      // Calculate fees per wallet

      // Balance Hstory per epoch
      if (epoch in result.balanceHistory) {
        if (tx.type !== TransactionType.receiver) {
          result.balanceHistory[epoch] =
            result.balanceHistory[epoch].minus(txFee);
        }
        if (tx.type === TransactionType.receiver) {
          result.balanceHistory[epoch] =
            result.balanceHistory[epoch].plus(bigTxValue);
        } else if (tx.type === TransactionType.transfer) {
          result.balanceHistory[epoch] =
            result.balanceHistory[epoch].minus(bigTxValue);
        } else if (tx.type === TransactionType.functionCall) {
          if (
            ['claimRewards', 'reDelegateRewards'].includes(tx.method as string)
          ) {
            result.balanceHistory[epoch] =
              result.balanceHistory[epoch].plus(bigTxValue);
          } else if (tx.method === 'unBond') {
            if (parseFloat(tx.fee) < 0) {
              txFee = new BigNumber('0.031760467');

              result.fees = result.fees.plus(txFee);
              result.available = result.available.minus(txFee);
              result.balanceHistory[epoch] =
                result.balanceHistory[epoch].minus(txFee);
            }
          } else if (tx.method === 'unStake') {
            if (parseFloat(tx.fee) < 0) {
              txFee = new BigNumber('0.036805533');
              result.fees = result.fees.plus(txFee);
              result.available = result.available.minus(txFee);
              result.balanceHistory[epoch] =
                result.balanceHistory[epoch].minus(txFee);
            }
          } else if (tx.method === 'stake') {
            if (parseFloat(tx.fee) < 0) {
              txFee = new BigNumber('0.039378847');
              result.fees = result.fees.plus(txFee);
              result.available = result.available.minus(txFee);
              result.balanceHistory[epoch] =
                result.balanceHistory[epoch].minus(txFee);
            }
          }
        }
      } else {
        if (tx.type !== TransactionType.receiver) {
          result.balanceHistory[epoch] = new BigNumber(0).minus(txFee);
        }
        if (tx.type === TransactionType.receiver) {
          result.balanceHistory[epoch] = bigTxValue;
        } else if (tx.type === TransactionType.transfer) {
          result.balanceHistory[epoch] = new BigNumber(0).minus(bigTxValue);
        } else if (tx.type === TransactionType.functionCall) {
          if (
            ['claimRewards', 'reDelegateRewards'].includes(tx.method as string)
          ) {
            result.balanceHistory[epoch] =
              result.balanceHistory[epoch].plus(bigTxValue);
          } else if (tx.method === 'unBond') {
            if (parseFloat(tx.fee) < 0) {
              txFee = new BigNumber('0.031760467');
              result.fees = result.fees.plus(txFee);
              result.available = result.available.minus(txFee);
              result.balanceHistory[epoch] = new BigNumber(0).minus(txFee);
            }
          } else if (tx.method === 'unStake') {
            if (parseFloat(tx.fee) < 0) {
              txFee = new BigNumber('0.036805533');
              result.fees = result.fees.plus(txFee);
              result.available = result.available.minus(txFee);
              result.balanceHistory[epoch] = new BigNumber(0).minus(txFee);
            }
          } else if (tx.method === 'stake') {
            if (parseFloat(tx.fee) < 0) {
              txFee = new BigNumber('0.039378847');
              result.fees = result.fees.plus(txFee);
              result.available = result.available.minus(txFee);
              result.balanceHistory[epoch] = new BigNumber(0).minus(txFee);
            }
          }
        }
      }

      // Balance Hstory per epoch
      fetchPrice.push(getEpochTimePrice(epoch, tx.timestamp, tx.txHash));

      if (tx.type === TransactionType.transfer) {
        result.available = result.available.minus(bigTxValue);
        result.actionTypes.outgoing += 1;
      }
      if (tx.type === TransactionType.receiver) {
        result.actionTypes.incoming += 1;
        result.available = result.available.plus(bigTxValue);
      }
      if (tx.type === TransactionType.self) {
        result.actionTypes.selfTransfer += 1;
      }
      if (tx.type === TransactionType.functionCall) {
        result.actionTypes.scCalls += 1;
      }
      if (tx.points) {
        result.points += tx.points;
      }
      if (tx.receiver === address) {
        if (tx.sender in result.topSenders) {
          result.topSenders[tx.sender] += 1;
        } else {
          result.topSenders[tx.sender] = 1;
        }
      }
      if (tx.sender === address) {
        if (tx.receiver in result.topReceivers) {
          result.topReceivers[tx.receiver] += 1;
        } else {
          result.topReceivers[tx.receiver] = 1;
        }
      }
      if (tx.method) {
        if (tx.method in result.topCalls) {
          result.topCalls[tx.method] += 1;
        } else {
          result.topCalls[tx.method] = 1;
        }
      }

      switch (tx.method) {
        case 'makeNewContractFromValidatorData':
          for (const scResult of tx.scResults) {
            const data = scResult.data;

            if (data !== undefined) {
              const data_list = data.split('@');
              if (data_list[1] == 'ok') {
                const agency = data_list[2];
                result.epochHistoryStaked[epoch] = {
                  ...result.epochHistoryStaked[epoch],
                  staked: {
                    [agency]: new BigNumber(
                      result.staked[
                        'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
                      ],
                    ),
                  },
                };
                result.staked = {
                  ...result.staked,
                  [agency]: new BigNumber(
                    result.staked[
                      'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
                    ],
                  ),
                };
                delete result.staked[
                  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
                ];
              }
            }
          }
          break;
        case 'mergeValidatorToDelegationWithWhitelist':
          const agency = AddressUtils.bech32Encode(tx.data.split('@')[1]);

          if (result.staked[agency]) {
            result.staked[agency] = result.staked[agency].plus(
              new BigNumber(
                result.staked[
                  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
                ],
              ),
            );
            if (!result.epochHistoryStaked[epoch]) {
              result.epochHistoryStaked[epoch] = {
                staked: {
                  [agency]: new BigNumber(result.staked[agency]),
                },
              };
            } else {
              if (!result.epochHistoryStaked[epoch].staked[agency]) {
                result.epochHistoryStaked[epoch].staked[agency] = new BigNumber(
                  result.staked[agency],
                );
              } else {
                result.epochHistoryStaked[epoch].staked[agency] = new BigNumber(
                  result.staked[agency],
                );
              }
            }
          } else {
            result.staked[agency] = new BigNumber(
              result.staked[
                'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
              ],
            );
            if (!result.epochHistoryStaked[epoch]) {
              result.epochHistoryStaked[epoch] = {
                staked: {
                  [agency]: new BigNumber(
                    result.staked[
                      'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
                    ],
                  ),
                },
              };
            } else {
              result.epochHistoryStaked[epoch].staked = {
                ...result.epochHistoryStaked[epoch].staked,
                [agency]: new BigNumber(
                  result.staked[
                    'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
                  ],
                ),
              };
            }
          }
          delete result.staked[
            'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l'
          ];
          break;
        case 'delegate':
          if (result.staked[tx.receiver]) {
            result.staked[tx.receiver] =
              result.staked[tx.receiver].plus(bigTxValue);
            if (!result.epochHistoryStaked[epoch]) {
              result.epochHistoryStaked[epoch] = {
                staked: {
                  [tx.receiver]: result.staked[tx.receiver],
                },
              };
            } else {
              if (!result.epochHistoryStaked[epoch].staked[tx.receiver]) {
                result.epochHistoryStaked[epoch].staked[tx.receiver] =
                  result.staked[tx.receiver];
              } else {
                result.epochHistoryStaked[epoch].staked[tx.receiver] =
                  result.staked[tx.receiver];
              }
            }
          } else {
            result.staked[tx.receiver] = new BigNumber(tx.value);
            if (!result.epochHistoryStaked[epoch]) {
              result.epochHistoryStaked[epoch] = {
                staked: {
                  [tx.receiver]: new BigNumber(tx.value),
                },
              };
            } else {
              result.epochHistoryStaked[epoch].staked = {
                ...result.epochHistoryStaked[epoch].staked,
                [tx.receiver]: new BigNumber(tx.value),
              };
            }
          }
          result.available = result.available.minus(bigTxValue);
          break;
        case 'reDelegateRewards':
          if (tx.receiver in result.staked) {
            result.staked[tx.receiver] =
              result.staked[tx.receiver].plus(bigTxValue);
            if (!result.epochHistoryStaked[epoch]) {
              result.epochHistoryStaked[epoch] = {
                staked: {
                  [tx.receiver]: result.staked[tx.receiver],
                },
              };
            } else {
              if (!result.epochHistoryStaked[epoch].staked[tx.receiver]) {
                result.epochHistoryStaked[epoch].staked[tx.receiver] =
                  result.staked[tx.receiver];
              } else {
                result.epochHistoryStaked[epoch].staked[tx.receiver] =
                  result.staked[tx.receiver];
              }
            }
          } else {
            result.staked[tx.receiver] = bigTxValue;
          }
          break;
        case 'claimRewards':
          result.available = result.available.plus(bigTxValue);
          break;
        case 'unDelegate':
          if (!result.unDelegated[tx.receiver]) {
            result.unDelegated[tx.receiver] = new BigNumber(0);
          }
          result.unDelegated[tx.receiver] =
            result.unDelegated[tx.receiver].plus(bigTxValue);
          result.staked[tx.receiver] =
            result.staked[tx.receiver].minus(bigTxValue);
          if (!result.epochHistoryStaked[epoch]) {
            result.epochHistoryStaked[epoch] = {
              staked: {
                [tx.receiver]: result.staked[tx.receiver],
              },
            };
          } else {
            if (!result.epochHistoryStaked[epoch].staked[tx.receiver]) {
              result.epochHistoryStaked[epoch].staked[tx.receiver] =
                result.staked[tx.receiver];
            } else {
              result.epochHistoryStaked[epoch].staked[tx.receiver] =
                result.staked[tx.receiver];
            }
          }

          break;
        case 'withdraw':
          result.unDelegated[tx.receiver] =
            result.unDelegated[tx.receiver].minus(bigTxValue);
          result.available = result.available.plus(bigTxValue);
          break;
        case 'createNewDelegationContract':
          tx.scResults.forEach((scTX: any) => {
            if (scTX.data !== undefined) {
              const agency = scTX.data.split('@')[2];
              result.staked = {
                [agency]: bigTxValue,
              };
              result.epochHistoryStaked[epoch] = {
                staked: {
                  [agency]: bigTxValue,
                },
              };
            }
          });
          result.available = result.available.minus(bigTxValue);

          break;
        case 'stake':
          result.available = result.available.minus(bigTxValue);
          if (!(tx.receiver in result.staked)) {
            result.staked[tx.receiver] = bigTxValue;
          } else {
            result.staked[tx.receiver] =
              result.staked[tx.receiver].plus(bigTxValue);
          }
          break;
        case 'unStake':
          if (
            tx.receiver ===
            'erd1qqqqqqqqqqqqqpgqxwakt2g7u9atsnr03gqcgmhcv38pt7mkd94q6shuwt'
          ) {
            if (!(tx.receiver in result.unDelegated)) {
              result.unDelegated[tx.receiver] = bigTxValue;
            } else {
              result.unDelegated[tx.receiver] =
                result.unDelegated[tx.receiver].plus(bigTxValue);
            }
            if (result.staked[tx.receiver]) {
              result.staked[tx.receiver] =
                result.staked[tx.receiver].minus(bigTxValue);
            }
          }

          break;
        case 'unBond':
          result.available = result.available.plus(bigTxValue);
          if (
            tx.receiver ==
            'erd1qqqqqqqqqqqqqpgqxwakt2g7u9atsnr03gqcgmhcv38pt7mkd94q6shuwt'
          ) {
            result.unDelegated[tx.receiver] =
              result.unDelegated[tx.receiver].minus(bigTxValue);
          }
          break;
      }
    }

    result.transactions = txs;
    result.points += result.accountAge * 5;
    result.topSenders = sortJSON(result.topSenders);
    result.topCalls = sortJSON(result.topCalls);
    result.topReceivers = sortJSON(result.topReceivers);

    // Merge tx price
    const priceResponses = await Promise.all(fetchPrice);
    let prices: Dictionary<string> = {};
    for (const response of priceResponses) {
      prices = { ...prices, [response.txHash]: response.price };
    }
    result.transactions = result.transactions.map((tx) => {
      tx.price = parseFloat(prices[tx.txHash]);
      return tx;
    });
    // Merge tx price

    // Compute balance history per epoch
    let lastEpochHistoryTotal = new BigNumber(0);
    const historyBalance: Dictionary<BigNumber> = {};
    for (let epoch = firstWalletEpoch; epoch <= todayEpoch; epoch++) {
      if (epoch in result.balanceHistory) {
        lastEpochHistoryTotal = lastEpochHistoryTotal.plus(
          result.balanceHistory[epoch],
        );
        historyBalance[epoch] = lastEpochHistoryTotal;
      } else {
        historyBalance[epoch] = lastEpochHistoryTotal;
      }
    }
    result.balanceHistory = historyBalance;
    // Compute balance history per epoch

    Object.keys(result.staked).forEach(function (address) {
      if (result.staked[address].isLessThan(new BigNumber(1))) {
        delete result.staked[address];
      } else {
        result.staked[address] = result.staked[address].toFixed();
      }
    });
    Object.keys(result.epochHistoryStaked).forEach(function (epoch) {
      Object.keys(result.epochHistoryStaked[epoch].staked).forEach(
        (address) => {
          result.epochHistoryStaked[epoch].staked[address] =
            result.epochHistoryStaked[epoch].staked[address].toFixed();
        },
      );
    });

    Object.keys(result.unDelegated).forEach(function (address) {
      if (result.unDelegated[address].lte(new BigNumber(0.0))) {
        delete result.unDelegated[address];
      } else {
        result.unDelegated[address] = result.unDelegated[address].toFixed();
      }
    });
    // result.available = NumberUtils.denominateFloat(result.available.toString());
    return result;
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

function sortJSON(jsObj: any): Dictionary<number> {
  const sortedArray = [];
  for (const i in jsObj) {
    sortedArray.push([jsObj[i], i]);
  }
  const sorted = sortedArray.sort(function (a, b) {
    return b[0] - a[0];
  });
  const result: Dictionary<number> = {};
  sorted.forEach((wallet) => {
    result[wallet[1]] = wallet[0];
  });
  return result;
}

const removeDuplicate = (arr: TransactionHistory[]) => {
  const appeared: Dictionary<number> = {};
  for (let i = 0; i < arr.length; ) {
    if (!appeared.hasOwnProperty(arr[i].txHash)) {
      appeared[arr[i].txHash] = 1;
      i++;
      continue;
    }
    arr.splice(i, 1);
  }
};

function daysSinceTime($start_ts: number, $end_ts: number) {
  const diff = $end_ts - $start_ts;
  return Math.round(diff / 86400);
}
const getEpochTimePrice = async (
  epoch: number,
  time: number,
  tx: string,
): Promise<any> => {
  const timeB = time - 50;
  const timeG = time + 50;
  const params = {
    TableName: 'EGLDUSD',
    Index: 'price',
    KeyConditionExpression: 'epoch = :ep AND #time BETWEEN :timB AND :timG',
    ExpressionAttributeNames: {
      '#time': 'timestamp',
    },
    ExpressionAttributeValues: {
      ':ep': { N: epoch.toString() },
      ':timB': { N: `${timeB}` },
      ':timG': { N: `${timeG}` },
    },
    Limit: 1,
  };
  const result = await db.send(new QueryCommand(params));
  let price: string | undefined = '0';
  try {
    if (result.Items) {
      price = result.Items[0].price.S;
    }
  } catch (error) {
    const params = {
      TableName: 'EGLDUSD',
      Index: 'price',
      KeyConditionExpression: 'epoch = :ep AND #time BETWEEN :timB AND :timG',
      ExpressionAttributeNames: {
        '#time': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':ep': { N: (epoch - 1).toString() },
        ':timB': { N: `${timeB}` },
        ':timG': { N: `${timeG}` },
      },
      Limit: 1,
    };
    const result = await db.send(new QueryCommand(params));
    try {
      if (result.Items) {
        price = result.Items[0].price.S;
      }
    } catch (error) {
      const params = {
        TableName: 'EGLDUSD',
        Index: 'price',
        KeyConditionExpression: 'epoch = :ep AND #time BETWEEN :timB AND :timG',
        ExpressionAttributeNames: {
          '#time': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':ep': { N: (epoch + 1).toString() },
          ':timB': { N: `${timeB}` },
          ':timG': { N: `${timeG}` },
        },
        Limit: 1,
      };
      const result = await db.send(new QueryCommand(params));
      try {
        if (result.Items) {
          price = result.Items[0].price.S;
        }
      } catch (error) {
        console.log(epoch);
        console.log('Start', timeB, ' End: ', timeG, ' Time: ', time);
      }
    }
    // console.log(result);
  }
  return { price, txHash: tx };
};

const Phase3 = {
  timestamp: 1617633000,
  epoch: 249,
};

// const getTimestampByEpoch = (epoch: number): number => {
//   let diff;
//   if (epoch >= Phase3.epoch) {
//     diff = epoch - Phase3.epoch;
//     return diff * (60 * 60 * 24) + Phase3.timestamp;
//   } else {
//     diff = Phase3.epoch - epoch;
//     return Phase3.timestamp - diff * (60 * 60 * 24);
//   }
// };

const getEpoch = (timestamp: number): number => {
  let diff;
  if (timestamp >= Phase3.timestamp) {
    diff = timestamp - Phase3.timestamp;
    return Phase3.epoch + Math.floor(diff / (60 * 60 * 24));
  } else {
    diff = Phase3.timestamp - timestamp;
    return Phase3.epoch - Math.floor(diff / (60 * 60 * 24));
  }
};

import { Injectable, Logger } from '@nestjs/common';
import { ApiConfigService } from 'src/common/api.config.service';
import { CachingService } from 'src/common/caching.service';
import { DataApiService } from 'src/common/data.api.service';
import { DataQuoteType } from 'src/common/entities/data.quote.type';
import { AbstractQuery } from 'src/common/entities/elastic/abstract.query';
import { ElasticPagination } from 'src/common/entities/elastic/elastic.pagination';
import { ElasticQuery } from 'src/common/entities/elastic/elastic.query';
import { ElasticSortOrder } from 'src/common/entities/elastic/elastic.sort.order';
import { ElasticSortProperty } from 'src/common/entities/elastic/elastic.sort.property';
import { QueryConditionOptions } from 'src/common/entities/elastic/query.condition.options';
import { QueryType } from 'src/common/entities/elastic/query.type';
import { GatewayService } from 'src/common/gateway.service';
import { AddressUtils } from 'src/utils/address.utils';
import { ApiUtils } from 'src/utils/api.utils';
import { BinaryUtils } from 'src/utils/binary.utils';
import { Constants } from 'src/utils/constants';
import { ElasticService } from '../../common/elastic.service';
import { SmartContractResult } from './entities/smart.contract.result';
import { Transaction } from './entities/transaction';
import { TransactionCreate } from './entities/transaction.create';
import { TransactionDetailed } from './entities/transaction.detailed';
import { TransactionFilter } from './entities/transaction.filter';
import { TransactionLog } from './entities/transaction.log';
import { TransactionLogEvent } from './entities/transaction.log.event';
import { TransactionLogEventIdentifier } from './entities/transaction.log.event.identifier';
import { TransactionOperation } from './entities/transaction.operation';
import { TransactionReceipt } from './entities/transaction.receipt';
import { TransactionSendResult } from './entities/transaction.send.result';
import { TransactionOperationType } from './entities/transaction.operation.type';
import { TransactionOperationAction } from './entities/transaction.operation.action';
import { QueryOperator } from 'src/common/entities/elastic/query.operator';
import { TransactionScamCheckService } from './scam-check/transaction-scam-check.service';
import { TransactionScamInfo } from './entities/transaction-scam-info';
import {
  LogsMatch,
  ReceiptsMatch,
  ScResultsMatch,
} from 'src/utils/trust.utils';
import { NumberUtils } from 'src/utils/number.utils';

@Injectable()
export class TransactionService {
  private readonly logger: Logger;

  constructor(
    private readonly elasticService: ElasticService,
    private readonly cachingService: CachingService,
    private readonly gatewayService: GatewayService,
    private readonly apiConfigService: ApiConfigService,
    private readonly dataApiService: DataApiService,
    private readonly transactionScamCheckService: TransactionScamCheckService,
  ) {
    this.logger = new Logger(TransactionService.name);
  }

  private buildTransactionFilterQuery(
    filter: TransactionFilter,
  ): AbstractQuery[] {
    const queries: AbstractQuery[] = [];
    if (filter.sender) {
      queries.push(QueryType.Match('sender', filter.sender));
    }

    if (filter.receiver) {
      queries.push(QueryType.Match('receiver', filter.receiver));
    }

    if (filter.token) {
      queries.push(QueryType.Match('tokens', filter.token, QueryOperator.AND));
    }

    if (filter.senderShard !== undefined) {
      queries.push(QueryType.Match('senderShard', filter.senderShard));
    }

    if (filter.receiverShard !== undefined) {
      queries.push(QueryType.Match('receiverShard', filter.receiverShard));
    }

    if (filter.miniBlockHash) {
      queries.push(QueryType.Match('miniBlockHash', filter.miniBlockHash));
    }

    if (filter.status) {
      queries.push(QueryType.Match('status', filter.status));
    }

    if (filter.search) {
      queries.push(QueryType.Wildcard('data', `*${filter.search}*`));
    }

    return queries;
  }

  async getAllTransactions(
    filter: TransactionFilter,
  ): Promise<TransactionDetailed[]> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();

    const { from, size } = filter;
    const pagination: ElasticPagination = {
      from,
      size,
    };
    elasticQueryAdapter.pagination = pagination;
    elasticQueryAdapter.condition[
      filter.condition ?? QueryConditionOptions.must
    ] = this.buildTransactionFilterQuery(filter);

    const timestamp: ElasticSortProperty = {
      name: 'timestamp',
      order: ElasticSortOrder.descending,
    };
    const nonce: ElasticSortProperty = {
      name: 'nonce',
      order: ElasticSortOrder.descending,
    };
    elasticQueryAdapter.sort = [timestamp, nonce];

    if (filter.before || filter.after) {
      elasticQueryAdapter.filter = [
        QueryType.Range('timestamp', filter.before ?? 0, filter.after ?? 0),
      ];
    }

    const elasticTransactions = await this.elasticService.getList(
      'transactions',
      'txHash',
      elasticQueryAdapter,
    );

    const transactions: TransactionDetailed[] = [];
    const transactionsHash: string[] = [];

    for (const elasticTransaction of elasticTransactions) {
      if (elasticTransaction.scResults) {
        elasticTransaction.results = elasticTransaction.scResults;
      }
      const transaction = ApiUtils.mergeObjects(
        new TransactionDetailed(),
        elasticTransaction,
      );
      transactionsHash.push(transaction.txHash);
      transaction.value = NumberUtils.denominateFloat(transaction.value);
      if (!transaction.fee.includes('-')) {
        transaction.fee = NumberUtils.denominateFloat(transaction.fee);
      } else {
        transaction.fee = `${'-'}${NumberUtils.denominateFloat(
          Math.abs(parseFloat(transaction.fee)).toString(),
        )}`;
      }
      if (transaction.data !== null) {
        transaction.data = Buffer.from(transaction.data, 'base64').toString();
      }
      const tokenTransfer = this.getTokenTransfer(elasticTransaction);
      if (tokenTransfer) {
        transaction.tokenValue = tokenTransfer.tokenAmount;
        transaction.tokenIdentifier = tokenTransfer.tokenIdentifier;
      }

      transactions.push(transaction);
    }

    if (!this.apiConfigService.getUseLegacyElastic()) {
      const scResults = await this.getScResultsForAllHashes(transactionsHash);
      Object.keys(scResults).forEach((txHash) => {
        scResults[txHash].forEach((txSC) => {
          transactionsHash.push(txSC.hash);
        });
      });
      const receipts = await this.getReceiptsForAllHashes(transactionsHash);
      const logs = await this.getLogsForAllHashes(transactionsHash);
      transactions.forEach((tx, index) => {
        if (tx.txHash in scResults) {
          transactions[index].results = scResults[tx.txHash];
          transactions[index].results.forEach((txSC, indexSCLog) => {
            if (txSC.hash in logs) {
              transactions[index].results[indexSCLog].logs = logs[tx.txHash][0];
            }
          });
        }
        transactions[index].results.forEach((scResult, indexSCResult) => {
          if (transactions[index].results[indexSCResult].value.includes('-')) {
            transactions[index].results[
              indexSCResult
            ].value = `${'-'}${NumberUtils.denominateFloat(
              Math.abs(
                parseFloat(transactions[index].results[indexSCResult].value),
              ).toString(),
            )}`;
          } else {
            transactions[index].results[indexSCResult].value =
              NumberUtils.denominateFloat(
                transactions[index].results[indexSCResult].value,
              );
          }
          if (scResult.data && scResult.data !== '') {
            transactions[index].results[indexSCResult].data = Buffer.from(
              transactions[index].results[indexSCResult].data,
              'base64',
            ).toString();
            const data_list =
              transactions[index].results[indexSCResult].data.split('@');
            const data_list_hex: string[] = [];
            if (data_list.length > 1) {
              data_list.forEach((info: any, kIndex: number) => {
                const command = tx.data.toString().split('@');
                if (
                  (command[0].localeCompare('createNewDelegationContract') ==
                    0 ||
                    command[0].localeCompare(
                      'makeNewContractFromValidatorData',
                    ) == 0) &&
                  info.includes('000000') &&
                  kIndex === 2
                ) {
                  data_list_hex.push(AddressUtils.bech32Encode(info));
                } else {
                  const val = Buffer.from(info, 'hex').toString();
                  data_list_hex.push(val);
                }
              });
            } else {
              if (
                scResult.data.includes('unbond') ||
                scResult.data.includes('claim')
              ) {
                transactions[index].value = scResult.value;
              }
            }
            transactions[index].results[indexSCResult].data =
              data_list_hex.join('@');
          } else {
            if (
              transactions[index].data === 'withdraw' ||
              transactions[index].data === 'reDelegateRewards' ||
              transactions[index].data === 'claimRewards'
            ) {
              if (parseFloat(scResult.value) > 0) {
                transactions[index].value = scResult.value;
              }
            }
          }
        });

        if (tx.txHash in receipts) {
          if (receipts[tx.txHash].length > 0) {
            transactions[index].receipt = receipts[tx.txHash][0];
          }
        }

        if (tx.txHash in logs) {
          transactions[index].logs = logs[tx.txHash][0];
          transactions[index].operations = this.getOperationsForTransactionLogs(
            tx.txHash,
            logs[tx.txHash],
          );
        }
      });
    }
    transactions.forEach((tx, index) => {
      transactions[index].results.forEach((scResult, indexSCResult) => {
        if (transactions[index].results[indexSCResult].value.includes('-')) {
          transactions[index].results[
            indexSCResult
          ].value = `${'-'}${NumberUtils.denominateFloat(
            Math.abs(
              parseFloat(transactions[index].results[indexSCResult].value),
            ).toString(),
          )}`;
        } else {
          transactions[index].results[indexSCResult].value =
            NumberUtils.denominateFloat(
              transactions[index].results[indexSCResult].value,
            );
        }
        if (scResult.data && scResult.data !== '') {
          transactions[index].results[indexSCResult].data = Buffer.from(
            transactions[index].results[indexSCResult].data,
            'base64',
          ).toString();
          const data_list =
            transactions[index].results[indexSCResult].data.split('@');
          const data_list_hex: string[] = [];
          if (data_list.length > 1) {
            data_list.forEach((info: any, kIndex: number) => {
              const command = tx.data.toString().split('@');
              if (
                (command[0].localeCompare('createNewDelegationContract') == 0 ||
                  command[0].localeCompare(
                    'makeNewContractFromValidatorData',
                  ) == 0) &&
                info.includes('000000') &&
                kIndex === 2
              ) {
                data_list_hex.push(AddressUtils.bech32Encode(info));
              } else {
                const val = Buffer.from(info, 'hex').toString();
                data_list_hex.push(val);
              }
            });
          } else {
            if (
              scResult.data.includes('unbond') ||
              scResult.data.includes('claim')
            ) {
              transactions[index].value = scResult.value;
            }
          }
          transactions[index].results[indexSCResult].data =
            data_list_hex.join('@');
        } else {
          if (
            transactions[index].data === 'withdraw' ||
            transactions[index].data === 'reDelegateRewards' ||
            transactions[index].data === 'claimRewards'
          ) {
            if (parseFloat(scResult.value) > 0) {
              transactions[index].value = scResult.value;
            }
          }
        }
      });
    });
    return transactions;
  }
  async getTransactionCount(filter: TransactionFilter): Promise<number> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();
    elasticQueryAdapter.condition[
      filter.condition ?? QueryConditionOptions.must
    ] = this.buildTransactionFilterQuery(filter);

    if (filter.before || filter.after) {
      elasticQueryAdapter.filter = [
        QueryType.Range('timestamp', filter.before ?? 0, filter.after ?? 0),
      ];
    }

    return await this.elasticService.getCount(
      'transactions',
      elasticQueryAdapter,
    );
  }

  async getTransactions(filter: TransactionFilter): Promise<Transaction[]> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();

    const { from, size } = filter;
    const pagination: ElasticPagination = {
      from,
      size,
    };
    elasticQueryAdapter.pagination = pagination;
    elasticQueryAdapter.condition[
      filter.condition ?? QueryConditionOptions.must
    ] = this.buildTransactionFilterQuery(filter);

    const timestamp: ElasticSortProperty = {
      name: 'timestamp',
      order: ElasticSortOrder.descending,
    };
    const nonce: ElasticSortProperty = {
      name: 'nonce',
      order: ElasticSortOrder.descending,
    };
    elasticQueryAdapter.sort = [timestamp, nonce];

    if (filter.before || filter.after) {
      elasticQueryAdapter.filter = [
        QueryType.Range('timestamp', filter.before ?? 0, filter.after ?? 0),
      ];
    }

    const elasticTransactions = await this.elasticService.getList(
      'transactions',
      'txHash',
      elasticQueryAdapter,
    );

    const transactions: Transaction[] = [];

    for (const elasticTransaction of elasticTransactions) {
      const transaction = ApiUtils.mergeObjects(
        new Transaction(),
        elasticTransaction,
      );

      const tokenTransfer = this.getTokenTransfer(elasticTransaction);
      if (tokenTransfer) {
        transaction.tokenValue = tokenTransfer.tokenAmount;
        transaction.tokenIdentifier = tokenTransfer.tokenIdentifier;
      }

      transactions.push(transaction);
    }

    return transactions;
  }

  private getTokenTransfer(
    elasticTransaction: any,
  ): { tokenIdentifier: string; tokenAmount: string } | undefined {
    if (!elasticTransaction.data) {
      return undefined;
    }

    const tokens = elasticTransaction.tokens;
    if (!tokens || tokens.length === 0) {
      return undefined;
    }

    const esdtValues = elasticTransaction.esdtValues;
    if (!esdtValues || esdtValues.length === 0) {
      return undefined;
    }

    const decodedData = BinaryUtils.base64Decode(elasticTransaction.data);
    if (!decodedData.startsWith('ESDTTransfer@')) {
      return undefined;
    }

    const token = tokens[0];
    const esdtValue = esdtValues[0];

    return { tokenIdentifier: token, tokenAmount: esdtValue };
  }

  async getTransaction(txHash: string): Promise<TransactionDetailed | null> {
    let transaction = await this.tryGetTransactionFromElastic(txHash);

    if (transaction === null) {
      transaction = await this.tryGetTransactionFromGateway(txHash);
    }

    if (transaction !== null) {
      const [price, scamInfo] = await Promise.all([
        this.getTransactionPrice(transaction),
        this.getScamInfo(transaction),
      ]);

      transaction.price = price;
      transaction.scamInfo = scamInfo;
    }

    return transaction;
  }

  private async getTransactionPrice(
    transaction: TransactionDetailed,
  ): Promise<number | undefined> {
    const dataUrl = this.apiConfigService.getDataUrl();
    if (!dataUrl) {
      return undefined;
    }

    const transactionDate = transaction.getDate();
    if (!transactionDate) {
      return undefined;
    }

    let price = await this.getTransactionPriceForDate(transactionDate);
    if (price) {
      price = Number(price).toRounded(2);
    }

    return price;
  }

  private async getTransactionPriceForDate(
    date: Date,
  ): Promise<number | undefined> {
    if (date.isToday()) {
      return await this.getTransactionPriceToday();
    }

    return await this.getTransactionPriceHistorical(date);
  }

  private async getTransactionPriceToday(): Promise<number | undefined> {
    return await this.cachingService.getOrSetCache(
      'currentPrice',
      async () =>
        await this.dataApiService.getQuotesHistoricalLatest(
          DataQuoteType.price,
        ),
      Constants.oneHour(),
    );
  }

  private async getTransactionPriceHistorical(
    date: Date,
  ): Promise<number | undefined> {
    return await this.cachingService.getOrSetCache(
      `price:${date.toISODateString()}`,
      async () =>
        await this.dataApiService.getQuotesHistoricalTimestamp(
          DataQuoteType.price,
          date.getTime() / 1000,
        ),
      Constants.oneDay() * 7,
    );
  }

  private async tryGetTransactionFromElasticBySenderAndNonce(
    sender: string,
    nonce: number,
  ): Promise<TransactionDetailed | undefined> {
    const query: ElasticQuery = new ElasticQuery();
    query.pagination = { from: 0, size: 1 };

    query.condition.must = [
      QueryType.Match('sender', sender),
      QueryType.Match('nonce', nonce),
    ];

    const transactions = await this.elasticService.getList(
      'transactions',
      'txHash',
      query,
    );

    return transactions.firstOrUndefined();
  }
  private async getScResultsForAllHashes(
    txHashes: string[],
  ): Promise<ScResultsMatch> {
    const elasticQueryAdapterSc: ElasticQuery = new ElasticQuery();
    elasticQueryAdapterSc.pagination = { from: 0, size: 10000 };

    const timestamp: ElasticSortProperty = {
      name: 'timestamp',
      order: ElasticSortOrder.ascending,
    };
    elasticQueryAdapterSc.sort = [timestamp];

    const queries = txHashes.map((tx) => {
      return QueryType.Match('originalTxHash', tx);
    });
    elasticQueryAdapterSc.condition.should = queries;
    let scResults: any[] =
      await this.elasticService.getSCResultsForTransactionHashes(
        elasticQueryAdapterSc,
      );
    scResults = scResults.map((document: any) =>
      this.elasticService.formatItem(document, 'scHash'),
    );
    const matchTX: ScResultsMatch = {};
    for (const scResult of scResults) {
      scResult.hash = scResult.scHash;
      delete scResult.scHash;
      if (scResult.originalTxHash in matchTX) {
        matchTX[scResult.originalTxHash].push(
          ApiUtils.mergeObjects(new SmartContractResult(), scResult),
        );
      } else {
        matchTX[scResult.originalTxHash] = [
          ApiUtils.mergeObjects(new SmartContractResult(), scResult),
        ];
      }
    }

    return matchTX;
  }

  private async getReceiptsForAllHashes(
    txHashes: string[],
  ): Promise<ReceiptsMatch> {
    const elasticQueryAdapterSc: ElasticQuery = new ElasticQuery();
    elasticQueryAdapterSc.pagination = { from: 0, size: 10000 };

    const timestamp: ElasticSortProperty = {
      name: 'timestamp',
      order: ElasticSortOrder.ascending,
    };
    elasticQueryAdapterSc.sort = [timestamp];

    const queries = txHashes.map((tx) => {
      return QueryType.Match('receiptHash', tx);
    });
    elasticQueryAdapterSc.condition.should = queries;
    let receipts: any[] =
      await this.elasticService.getReceiptsForTransactionHashes(
        elasticQueryAdapterSc,
      );
    receipts = receipts.map((document: any) =>
      this.elasticService.formatItem(document, 'receiptHash'),
    );

    const matchTX: ReceiptsMatch = {};
    for (const receipt of receipts) {
      if (receipt._source.receiptHash in matchTX) {
        matchTX[receipt._source.receiptHash].push(
          ApiUtils.mergeObjects(new TransactionReceipt(), receipt._source),
        );
      } else {
        matchTX[receipt._source.receiptHash] = [
          ApiUtils.mergeObjects(new TransactionReceipt(), receipt._source),
        ];
      }
    }

    return matchTX;
  }

  private async getLogsForAllHashes(txHashes: string[]): Promise<LogsMatch> {
    const elasticQueryAdapterSc: ElasticQuery = new ElasticQuery();
    elasticQueryAdapterSc.pagination = { from: 0, size: 10000 };

    const timestamp: ElasticSortProperty = {
      name: 'timestamp',
      order: ElasticSortOrder.ascending,
    };
    elasticQueryAdapterSc.sort = [timestamp];

    const queries = txHashes.map((tx) => {
      return QueryType.Match('_id', tx);
    });
    elasticQueryAdapterSc.condition.should = queries;
    const logs: any[] = await this.elasticService.getLogsForTransactionHashes(
      elasticQueryAdapterSc,
    );
    const matchTX: LogsMatch = {};
    for (const log of logs) {
      if (log._id in matchTX) {
        matchTX[log._id].push(
          ApiUtils.mergeObjects(new TransactionLog(), log._source),
        );
      } else {
        matchTX[log._id] = [
          ApiUtils.mergeObjects(new TransactionLog(), log._source),
        ];
      }
    }

    return matchTX;
  }
  async tryGetTransactionFromElastic(
    txHash: string,
  ): Promise<TransactionDetailed | null> {
    try {
      const result = await this.elasticService.getItem(
        'transactions',
        'txHash',
        txHash,
      );

      if (result.scResults) {
        result.results = result.scResults;
      }

      const transactionDetailed: TransactionDetailed = ApiUtils.mergeObjects(
        new TransactionDetailed(),
        result,
      );
      const tokenTransfer = this.getTokenTransfer(result);
      if (tokenTransfer) {
        transactionDetailed.tokenValue = tokenTransfer.tokenAmount;
        transactionDetailed.tokenIdentifier = tokenTransfer.tokenIdentifier;
      }

      const hashes: string[] = [];
      hashes.push(txHash);

      if (!this.apiConfigService.getUseLegacyElastic()) {
        const elasticQueryAdapterSc: ElasticQuery = new ElasticQuery();
        elasticQueryAdapterSc.pagination = { from: 0, size: 100 };

        const timestamp: ElasticSortProperty = {
          name: 'timestamp',
          order: ElasticSortOrder.ascending,
        };
        elasticQueryAdapterSc.sort = [timestamp];

        const originalTxHashQuery = QueryType.Match('originalTxHash', txHash);
        elasticQueryAdapterSc.condition.must = [originalTxHashQuery];

        if (result.hasScResults === true) {
          const scResults = await this.elasticService.getList(
            'scresults',
            'scHash',
            elasticQueryAdapterSc,
          );
          for (const scResult of scResults) {
            scResult.hash = scResult.scHash;
            hashes.push(scResult.hash);

            delete scResult.scHash;
          }

          transactionDetailed.results = scResults.map((scResult) =>
            ApiUtils.mergeObjects(new SmartContractResult(), scResult),
          );
        }

        const elasticQueryAdapterReceipts: ElasticQuery = new ElasticQuery();
        elasticQueryAdapterReceipts.pagination = { from: 0, size: 1 };

        const receiptHashQuery = QueryType.Match('receiptHash', txHash);
        elasticQueryAdapterReceipts.condition.must = [receiptHashQuery];

        const receipts = await this.elasticService.getList(
          'receipts',
          'receiptHash',
          elasticQueryAdapterReceipts,
        );
        if (receipts.length > 0) {
          const receipt = receipts[0];
          transactionDetailed.receipt = ApiUtils.mergeObjects(
            new TransactionReceipt(),
            receipt,
          );
        }

        const elasticQueryAdapterLogs: ElasticQuery = new ElasticQuery();
        elasticQueryAdapterLogs.pagination = { from: 0, size: 100 };

        const queries = [];
        for (const hash of hashes) {
          queries.push(QueryType.Match('_id', hash));
        }
        elasticQueryAdapterLogs.condition.should = queries;

        const logs: any[] =
          await this.elasticService.getLogsForTransactionHashes(
            elasticQueryAdapterLogs,
          );
        const transactionLogs = logs.map((log) =>
          ApiUtils.mergeObjects(new TransactionLog(), log._source),
        );

        transactionDetailed.operations = this.getOperationsForTransactionLogs(
          txHash,
          transactionLogs,
        );

        for (const log of logs) {
          if (log._id === txHash) {
            transactionDetailed.logs = ApiUtils.mergeObjects(
              new TransactionLog(),
              log._source,
            );
          } else {
            const foundScResult = transactionDetailed.results.find(
              ({ hash }) => log._id === hash,
            );
            if (foundScResult) {
              foundScResult.logs = ApiUtils.mergeObjects(
                new TransactionLog(),
                log._source,
              );
            }
          }
        }
      }

      return ApiUtils.mergeObjects(
        new TransactionDetailed(),
        transactionDetailed,
      );
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  getOperationsForTransactionLogs(
    txHash: string,
    logs: TransactionLog[],
  ): TransactionOperation[] {
    const operations: (TransactionOperation | undefined)[] = [];

    for (const log of logs) {
      for (const event of log.events) {
        switch (event.identifier) {
          case TransactionLogEventIdentifier.ESDTNFTTransfer:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.transfer,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTNFTBurn:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.burn,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTNFTAddQuantity:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.addQuantity,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTNFTCreate:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.create,
              ),
            );
            break;
          case TransactionLogEventIdentifier.MultiESDTNFTTransfer:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.multiTransfer,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTTransfer:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.transfer,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTBurn:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.burn,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTLocalMint:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.localMint,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTLocalBurn:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.localBurn,
              ),
            );
            break;
          case TransactionLogEventIdentifier.ESDTWipe:
            operations.push(
              this.getTransactionNftOperation(
                txHash,
                log,
                event,
                TransactionOperationAction.wipe,
              ),
            );
            break;
        }
      }
    }

    return operations
      .filter((operation) => operation !== undefined)
      .map((operation) => operation!);
  }

  private getTransactionNftOperation(
    txHash: string,
    log: TransactionLog,
    event: TransactionLogEvent,
    action: TransactionOperationAction,
  ): TransactionOperation | undefined {
    try {
      let identifier = BinaryUtils.base64Decode(event.topics[0]);
      const nonce = BinaryUtils.tryBase64ToHex(event.topics[1]);
      const value =
        BinaryUtils.tryBase64ToBigInt(event.topics[2])?.toString() ?? '0';
      const receiver =
        BinaryUtils.tryBase64ToAddress(event.topics[3]) ?? log.address;

      let collection: string | undefined = undefined;
      if (nonce) {
        collection = identifier;
        identifier = `${collection}-${nonce}`;
      }

      const type = nonce
        ? TransactionOperationType.nft
        : TransactionOperationType.esdt;

      return {
        action,
        type,
        collection,
        identifier,
        sender: event.address,
        receiver,
        value,
      };
    } catch (error) {
      this.logger.error(
        `Error when parsing NFT transaction log for tx hash '${txHash}' with action '${action}' and topics: ${event.topics}`,
      );
      this.logger.error(error);
      return undefined;
    }
  }

  async tryGetTransactionFromGateway(
    txHash: string,
  ): Promise<TransactionDetailed | null> {
    try {
      const { transaction } = await this.gatewayService.get(
        `transaction/${txHash}?withResults=true`,
      );

      if (transaction.status === 'pending') {
        const existingTransaction =
          await this.tryGetTransactionFromElasticBySenderAndNonce(
            transaction.sender,
            transaction.nonce,
          );
        if (existingTransaction && existingTransaction.txHash !== txHash) {
          return null;
        }
      }

      if (transaction.receipt) {
        transaction.receipt.value = transaction.receipt.value.toString();
      }

      if (transaction.smartContractResults) {
        for (const smartContractResult of transaction.smartContractResults) {
          smartContractResult.callType =
            smartContractResult.callType.toString();
          smartContractResult.value = smartContractResult.value.toString();

          if (smartContractResult.data) {
            smartContractResult.data = BinaryUtils.base64Encode(
              smartContractResult.data,
            );
          }
        }
      }

      const result = {
        txHash: txHash,
        data: transaction.data,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        gasUsed: transaction.gasUsed,
        miniBlockHash: transaction.miniblockHash,
        senderShard: transaction.sourceShard,
        receiverShard: transaction.destinationShard,
        nonce: transaction.nonce,
        receiver: transaction.receiver,
        sender: transaction.sender,
        signature: transaction.signature,
        status: transaction.status,
        value: transaction.value,
        round: transaction.round,
        fee: transaction.fee,
        timestamp: transaction.timestamp,
        scResults: transaction.smartContractResults
          ? transaction.smartContractResults.map((scResult: any) =>
              ApiUtils.mergeObjects(new SmartContractResult(), scResult),
            )
          : [],
        receipt: transaction.receipt
          ? ApiUtils.mergeObjects(new TransactionReceipt(), transaction.receipt)
          : undefined,
        logs: transaction.logs,
      };

      return ApiUtils.mergeObjects(new TransactionDetailed(), result);
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  async createTransaction(
    transaction: TransactionCreate,
  ): Promise<TransactionSendResult | string> {
    const receiverShard = AddressUtils.computeShard(
      AddressUtils.bech32Decode(transaction.receiver),
    );
    const senderShard = AddressUtils.computeShard(
      AddressUtils.bech32Decode(transaction.sender),
    );

    let txHash: string;
    try {
      const result = await this.gatewayService.create(
        'transaction/send',
        transaction,
      );
      txHash = result.txHash;
    } catch (error) {
      this.logger.error(error);
      return error.response.data.error;
    }

    // TODO: pending alignment
    return {
      txHash,
      receiver: transaction.receiver,
      sender: transaction.sender,
      receiverShard,
      senderShard,
      status: 'Pending',
    };
  }

  private async getScamInfo(
    transaction: TransactionDetailed,
  ): Promise<TransactionScamInfo | undefined> {
    const extrasApiUrl = this.apiConfigService.getExtrasApiUrl();
    if (!extrasApiUrl) {
      return undefined;
    }

    return await this.transactionScamCheckService.getScamInfo(transaction);
  }
}

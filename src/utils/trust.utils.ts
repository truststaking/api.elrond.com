import { SmartContractResult } from 'src/endpoints/transactions/entities/smart.contract.result';
import { TransactionLog } from 'src/endpoints/transactions/entities/transaction.log';
import { TransactionOperation } from 'src/endpoints/transactions/entities/transaction.operation';
import { TransactionReceipt } from 'src/endpoints/transactions/entities/transaction.receipt';

export interface Dictionary<T> {
  [Key: string]: T;
}

export interface ScResultsMatch {
  [Key: string]: SmartContractResult[];
}
export interface ReceiptsMatch {
  [Key: string]: TransactionReceipt[];
}
export interface LogsMatch {
  [Key: string]: TransactionLog[];
}
export interface OperationsMatch {
  [Key: string]: TransactionOperation[];
}

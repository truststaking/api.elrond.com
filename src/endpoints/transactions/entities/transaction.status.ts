export enum TransactionStatus {
  success = 'success',
  pending = 'pending',
  fail = 'fail',
}
export enum TransactionType {
  functionCall = 'Function Call',
  transfer = 'Transfer',
  receiver = 'Receiver',
  self = 'Self Transfer',
  esdtTransfer = 'ESDT Transfer',
}
export enum TransactionPoint {
  transfer = 10,
  receiver = 2,
  scCall = 25,
  contractDeployment = 100,
}

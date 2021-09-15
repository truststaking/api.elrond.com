import { Test } from '@nestjs/testing';
import { PublicAppModule } from 'src/public.app.module';
import { Transaction } from 'src/endpoints/transactions/entities/transaction';
import { TransactionStatus } from 'src/endpoints/transactions/entities/transaction.status';
import { TransactionService } from 'src/endpoints/transactions/transaction.service';
import { TransactionFilter } from 'src/endpoints/transactions/entities/transaction.filter';
import Initializer from './e2e-init';
import { Constants } from 'src/utils/constants';

describe('Transaction Service', () => {
    let transactionService: TransactionService;
    let transactionHash: string;
    let transactionSender: string;
    let transactionReceiver: string;

    beforeAll(async () => {
      await Initializer.initialize();
    }, Constants.oneHour() * 1000);
  
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
          imports: [PublicAppModule],
        }).compile();
  
        transactionService = moduleRef.get<TransactionService>(TransactionService);

        const transactionFilter = new TransactionFilter();
        transactionFilter.from = 0;
        transactionFilter.size = 1;

        let transactions = await transactionService.getTransactions(transactionFilter);
        expect(transactions).toHaveLength(1);

        let transaction = transactions[0];
        transactionHash = transaction.txHash;
        transactionSender = transaction.sender;
        transactionReceiver = transaction.receiver;

    });

    describe('Transactions list', () => {
        it('transactions should have txHash, sender and receiver', async () => {
            const transactionFilter = new TransactionFilter();
            transactionFilter.from = 0;
            transactionFilter.size = 25;
            const transactionsList = await transactionService.getTransactions(transactionFilter);

            for (let transaction of transactionsList) {
                expect(transaction).toHaveProperty('txHash');
                expect(transaction).toHaveProperty('sender');
                expect(transaction).toHaveProperty('receiver');
            }
        });

        describe('Transactions pagination', () => {
            it(`should return a list with 25 transactions`, async () => {
                const transactionFilter = new TransactionFilter();
                transactionFilter.from = 0;
                transactionFilter.size = 25;
                const transactionsList = await transactionService.getTransactions(transactionFilter);
    
                expect(transactionsList).toBeInstanceOf(Array);
                expect(transactionsList).toHaveLength(25);
    
                for (let transaction of transactionsList) {
                    expect(transaction).toHaveStructure(Object.keys(new Transaction()));
                }
            });
    
            it(`should return a list with 100 transactions`, async () => {
                const transactionFilter = new TransactionFilter();
                transactionFilter.from = 0;
                transactionFilter.size = 100;
                const transactionsList = await transactionService.getTransactions(transactionFilter);

                expect(transactionsList).toBeInstanceOf(Array);
                expect(transactionsList).toHaveLength(100);
    
                for (let transaction of transactionsList) {
                    expect(transaction).toHaveStructure(Object.keys(new Transaction()));
                }
            });
        })
        
        describe('Transactions filters', () => {
            it(`should return a list of transactions between two accounts`, async () => {
                const transactionFilter = new TransactionFilter();
                transactionFilter.from = 0;
                transactionFilter.size = 25;
                transactionFilter.sender = transactionSender;
                transactionFilter.receiver = transactionReceiver;
                const transactionsList = await transactionService.getTransactions(transactionFilter);

                expect(transactionsList).toBeInstanceOf(Array);
    
                for (let transaction of transactionsList) {
                    expect(transaction).toHaveStructure(Object.keys(new Transaction()));
                    expect(transaction.sender).toBe(transactionSender);
                    expect(transaction.receiver).toBe(transactionReceiver);
                }
            });
    
            it(`should return a list with pending transactions`, async () => {
                const transactionFilter = new TransactionFilter();
                transactionFilter.from = 0;
                transactionFilter.size = 25;
                transactionFilter.status = TransactionStatus.pending;
                const transactionsList = await transactionService.getTransactions(transactionFilter);
                expect(transactionsList).toBeInstanceOf(Array);

                for (let transaction of transactionsList) {
                    expect(transaction).toHaveStructure(Object.keys(new Transaction()));
                    expect(transaction.status).toBe(TransactionStatus.pending);
                }
            });

            it(`should return a list with transactions in one date range`, async () => {
                const transactionFilter = new TransactionFilter();
                transactionFilter.from = 0;
                transactionFilter.size = 25;
                transactionFilter.before = 1625559162;
                transactionFilter.after = 1625559108;
                const transactionsList = await transactionService.getTransactions(transactionFilter);
                expect(transactionsList).toBeInstanceOf(Array);
    
                for (let transaction of transactionsList) {
                    expect(transaction).toHaveStructure(Object.keys(new Transaction()));
                    expect(transaction.timestamp).toBeGreaterThanOrEqual(transactionFilter.after);
                    expect(transaction.timestamp).toBeLessThanOrEqual(transactionFilter.before);
                }
            });

            it(`should return a list with transactions for an address, in one date range, with success status`, async () => {
                const address = transactionSender
                const transactionFilter = new TransactionFilter();
                transactionFilter.from = 0;
                transactionFilter.size = 25;
                transactionFilter.after = 1625559108;
                transactionFilter.sender = address;
                // transactionFilter.receiver = address;
                transactionFilter.status = TransactionStatus.success;
                // transactionFilter.condition = QueryConditionOptions.should;

                const transactionsList = await transactionService.getTransactions(transactionFilter);
                expect(transactionsList).toBeInstanceOf(Array);
    
                for (let transaction of transactionsList) {
                    expect(transaction).toHaveStructure(Object.keys(new Transaction()));
                    if(transaction.sender !== address && transaction.receiver !== address)
                    {
                        expect(false);
                    }
                    expect(transaction.timestamp).toBeGreaterThanOrEqual(transactionFilter.after);
                    expect(transaction.status).toBe(TransactionStatus.success);
                }
            });
        })
    
    });

    describe('Transaction count', () => {
        it(`should return a number`, async () => {
            const transactionsCount: Number = new Number(await transactionService.getTransactionCount(new TransactionFilter()));

            expect(transactionsCount).toBeInstanceOf(Number);
        });
    })

    describe('Specific transaction', () => {
        it(`should return a transaction for a specific hash`, async () => {
            const transaction = await transactionService.getTransaction(transactionHash);

            if (transaction) {
             expect(transaction.txHash).toBe(transactionHash);
            }
        });

        it(`should throw 'Transaction not found' error`, async () => {
            expect(await transactionService.getTransaction(transactionHash + 'a')).toBeNull();
        });
    })
});
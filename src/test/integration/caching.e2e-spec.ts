import { Test } from '@nestjs/testing';
import { CachingService } from 'src/common/caching.service';
import { PublicAppModule } from 'src/public.app.module';
import { Constants } from 'src/utils/constants';
import Initializer from './e2e-init';

describe('Caching Service', () => {
  let cachingService: CachingService;

  beforeAll(async () => {
    await Initializer.initialize();
  }, Constants.oneHour() * 1000);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
        imports: [PublicAppModule],
      }).compile();

    cachingService = moduleRef.get<CachingService>(CachingService);
  });

  describe('Cache Local', () => {
    //CRUD
    it(`should return undefined, 'test' key isn't set`, async () => {
      const cacheValue = await cachingService.getCacheLocal('test');
      expect(cacheValue).toBeUndefined();
    });

    it(`should return 'test' value after key is set`, async () => {
      await cachingService.setCacheLocal('test', 'test', Constants.oneSecond());

      const cacheValue = await cachingService.getCacheLocal('test');
      expect(cacheValue).toBe('test');
    });

    it(`should return 'test-update' value after key is set`, async () => {
      await cachingService.setCacheLocal('test', 'test-update', Constants.oneSecond());

      const cacheValue = await cachingService.getCacheLocal('test');
      expect(cacheValue).toBe('test-update');
    });

    it(`should return undefined because key is invalidated`, async() => {
      await cachingService.deleteInCache('test');

      const cacheValue = await cachingService.getCacheLocal('test');
      expect(cacheValue).toBeUndefined();
    });

  });

  describe('Get Or Set Cache', () => {
    it(`should return 'test' value after key is set`, async () => {
      const cacheValue = await cachingService.getOrSetCache('test', async () => 'test', Constants.oneSecond());
      expect(cacheValue).toBe('test');
    })
  });

  describe('Batch process in chunks', () => {
    let input: Array<Number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    let output: Array<String> = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15'];
    let emptyOutput: Array<any> = Array(15).fill(null);
    let cacheKeyFunction = (number: Number) => number.toString();
    let handlerFunction = async(number: Number) => await number.toString();

    it(`should return emptyOutput because keys aren't set`, async () => {
      const cacheValueChunks = await cachingService.batchGetCache(input.map((x) => cacheKeyFunction(x)));

      expect(cacheValueChunks).toStrictEqual(emptyOutput);
    });

    it(`should return ouput keys as string`, async () => {
      await cachingService.batchProcess(input, cacheKeyFunction, handlerFunction, Constants.oneSecond());

      const cacheValueChunks = await cachingService.batchGetCache(input.map((x) => cacheKeyFunction(x)));
      expect(cacheValueChunks).toStrictEqual(output);
    });

  });

});
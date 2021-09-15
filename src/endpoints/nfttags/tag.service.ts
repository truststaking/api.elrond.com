import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { QueryPagination } from 'src/common/entities/query.pagination';
import { CachingService } from 'src/common/caching.service';
import { ElasticService } from 'src/common/elastic.service';
import { ElasticQuery } from 'src/common/entities/elastic/elastic.query';
import { ElasticSortOrder } from 'src/common/entities/elastic/elastic.sort.order';
import { ElasticSortProperty } from 'src/common/entities/elastic/elastic.sort.property';
import { ApiUtils } from 'src/utils/api.utils';
import { Constants } from 'src/utils/constants';
import { Tag } from './entities/tag';

@Injectable()
export class TagService {
  constructor(
    private readonly elasticService: ElasticService,
    @Inject(forwardRef(() => CachingService))
    private readonly cachingService: CachingService,
  ) {}

  async getNftTags(pagination: QueryPagination): Promise<Tag[]> {
    return this.cachingService.getOrSetCache(
      'nftTags',
      async () => await this.getNftTagsRaw(pagination),
      Constants.oneHour(),
    );
  }

  async getNftTagsRaw(pagination: QueryPagination): Promise<Tag[]> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();
    elasticQueryAdapter.pagination = pagination;

    const count: ElasticSortProperty = {
      name: 'count',
      order: ElasticSortOrder.descending,
    };
    elasticQueryAdapter.sort = [count];

    const result = await this.elasticService.getList(
      'tags',
      'tag',
      elasticQueryAdapter,
    );

    const nftTags: Tag[] = result.map((item) =>
      ApiUtils.mergeObjects(new Tag(), item),
    );

    return nftTags;
  }

  async getNftTag(tag: string): Promise<Tag> {
    const result = await this.elasticService.getItem('tags', 'tag', tag);

    return ApiUtils.mergeObjects(new Tag(), result);
  }
}

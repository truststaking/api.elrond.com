import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  getEpoch,
  getProfile,
  getTimestampByEpoch,
  db,
} from 'src/utils/trust.utils';
import { ProviderService } from '../providers/provider.service';

export class AVGAPR {
  @ApiProperty()
  data: AVGAPRData[] = [];
}
interface Dictionary<T> {
  [Key: string]: T;
}

export class AVGAPRData {
  @ApiProperty()
  avg_apy = '';
  @ApiProperty()
  daily_apy = '';
  @ApiProperty()
  date = '';
  @ApiProperty()
  epoch = '';
  @ApiProperty()
  name = '';
  @ApiProperty()
  owner = '';
  @ApiProperty()
  provider = '';
  @ApiProperty()
  timestamp = 0;
}
@Injectable()
export class AVGAPRService {
  constructor(private readonly providerService: ProviderService) {}
  async getAVGHistory(): Promise<AVGAPR> {
    const data = await this.providerService.getProviderAddresses();
    try {
      const array: Dictionary<AVGAPRData> = {};
      const keybaseIDs: Dictionary<any> = {};
      let accumulated: any[] = [];
      const todayEpoch = getEpoch(Math.floor(Date.now() / 1000));
      const metaDataPromises = [];
      for (const SC of data) {
        metaDataPromises.push(this.providerService.getProviderMetadata(SC));
        const params = {
          TableName: 'avg_apy',
          Index: 'owner',
          KeyConditionExpression: 'provider = :SC AND epoch = :EP',
          ExpressionAttributeValues: {
            ':SC': { S: SC },
            ':EP': { N: `${todayEpoch}` },
          },
        };
        const result = await db.send(new QueryCommand(params));
        if (result.Items) {
          accumulated = [...accumulated, ...result.Items];
        }
      }
      const getProfileResponses = [];
      const metaDataResponse = await Promise.all(metaDataPromises);
      for (const response of metaDataResponse) {
        getProfileResponses.push(
          getProfile(response['identity'], response['address']),
        );
      }
      const keybaseReponses = await Promise.all(getProfileResponses);
      for (const SC of data) {
        keybaseIDs[SC] = keybaseReponses.filter(
          (item) => item.address === SC,
        )[0];
      }
      accumulated.forEach((data) => {
        const tmpData = data;
        Object.keys(data).forEach((fieldName) => {
          Object.keys(data[fieldName]).forEach((fieldType) => {
            tmpData[fieldName] = data[fieldName][fieldType];
            if (fieldName === 'epoch') {
              tmpData['timestamp'] = getTimestampByEpoch(
                parseInt(data[fieldName]),
              );
            }
          });
        });
        if (!array[data.provider]) {
          array[data.provider] = new AVGAPRData();
        }
        array[data.provider] = {
          ...array[data.provider],
          name: keybaseIDs[data.provider]
            ? keybaseIDs[data.provider].name
            : data.provider,
          ...data,
          date: new Date(
            getTimestampByEpoch(parseInt(data.epoch)) * 1000,
          ).toLocaleDateString(),
        };
      });
      const graphData = Object.keys(array).map((value) => {
        return array[value];
      });
      return { data: graphData };
    } catch (err) {
      return new AVGAPR();
    }
  }
}

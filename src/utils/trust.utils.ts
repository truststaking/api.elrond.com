import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import axios from 'axios';

export const db = new DynamoDBClient({ region: 'eu-west-1' });

interface GetPrice {
  price: string;
  txHash: string;
}

export const getEpochTimePrice = async (
  epoch: number,
  time: number,
  tx: string,
): Promise<GetPrice> => {
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
  let price = '0';
  try {
    if (
      result.Items &&
      result.Items[0] &&
      result.Items[0].price &&
      result.Items[0].price.S
    ) {
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
      if (
        result.Items &&
        result.Items[0] &&
        result.Items[0].price &&
        result.Items[0].price.S
      ) {
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
        if (
          result.Items &&
          result.Items[0] &&
          result.Items[0].price &&
          result.Items[0].price.S
        ) {
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

export const Phase3 = {
  timestamp: 1617633000,
  epoch: 249,
};

export const getEpoch = (timestamp: number): number => {
  let diff;
  if (timestamp >= Phase3.timestamp) {
    diff = timestamp - Phase3.timestamp;
    return Phase3.epoch + Math.floor(diff / (60 * 60 * 24));
  } else {
    diff = Phase3.timestamp - timestamp;
    return Phase3.epoch - Math.floor(diff / (60 * 60 * 24));
  }
};

export const getTimestampByEpoch = (epoch: number): number => {
  let diff;
  if (epoch >= Phase3.epoch) {
    diff = epoch - Phase3.epoch;
    return diff * (60 * 60 * 24) + Phase3.timestamp;
  } else {
    diff = Phase3.epoch - epoch;
    return Phase3.timestamp - diff * (60 * 60 * 24);
  }
};

export const getTodayPrice = async (): Promise<number> => {
  const { data } = await axios.get(
    'https://data.elrond.com/latest/quotes/egld/price',
  );
  return data;
};

export const getTodayRates = async () => {
  const { data } = await axios.get(
    'http://freecurrencyapi.net/api/v1/rates?base_currency=usd&apikey=91f0c190-ebdf-11eb-be37-d903e042eb34',
  );
  let result = {};
  Object.keys(data.data).forEach((key) => {
    result = data.data[key];
  });
  return result;
};

export const getProfile = async (identity: string, address = {}) => {
  let value;

  try {
    const { status, data } = await axios.get(
      `https://keybase.io/_/api/1.0/user/lookup.json?username=${identity}`,
    );

    if (status === 200 && data.status.code === 0) {
      const { profile, pictures } = data.them;

      const { proofs_summary } = data.them || {};
      const { all } = proofs_summary || {};

      const twitter = all.find(
        (element: { [x: string]: string }) =>
          element['proof_type'] === 'twitter',
      );
      const website = all.find(
        (element: { [x: string]: string }) =>
          element['proof_type'] === 'dns' ||
          element['proof_type'] === 'generic_web_site',
      );
      value = {
        address,
        identity,
        name: profile && profile.full_name ? profile.full_name : undefined,
        description: profile && profile.bio ? profile.bio : undefined,
        avatar:
          pictures && pictures.primary && pictures.primary.url
            ? pictures.primary.url
            : undefined,
        twitter:
          twitter && twitter.service_url ? twitter.service_url : undefined,
        website:
          website && website.service_url ? website.service_url : undefined,
        location: profile && profile.location ? profile.location : undefined,
      };
    } else {
      value = {
        address: '',
      };
    }
  } catch (error) {
    value = {
      address: '',
    };
  }

  return value;
};

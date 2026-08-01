import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

export interface ObjectContent {
  body: Readable;
  contentLength?: number;
  contentType?: string;
}

function createClient(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "local",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin"
    }
  });
}

export function createObjectStore() {
  const client = createClient();
  const bucket = process.env.S3_BUCKET ?? "mediaforge-local";

  return {
    async put(
      key: string,
      body: AsyncIterable<Uint8Array>,
      contentType: string,
      contentLength: number
    ): Promise<string | undefined> {
      const result = await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Readable.from(body),
        ContentType: contentType,
        ContentLength: contentLength
      }));
      return result.ETag;
    },

    async get(key: string): Promise<ObjectContent> {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body || !(result.Body instanceof Readable)) {
        throw new Error("RESOURCE_OBJECT_BODY_UNAVAILABLE");
      }
      return {
        body: result.Body,
        ...(result.ContentLength !== undefined ? { contentLength: result.ContentLength } : {}),
        ...(result.ContentType ? { contentType: result.ContentType } : {})
      };
    },

    async deleteMany(keys: string[]): Promise<void> {
      const uniqueKeys = [...new Set(keys)].filter(Boolean);
      for (let index = 0; index < uniqueKeys.length; index += 10) {
        await Promise.all(uniqueKeys.slice(index, index + 10).map((Key) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key }))));
      }
    },

    destroy(): void {
      client.destroy();
    }
  };
}

export type ObjectStore = ReturnType<typeof createObjectStore>;

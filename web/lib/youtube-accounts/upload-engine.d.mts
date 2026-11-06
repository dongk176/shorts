export type UploadJob = { size: number; channelId: string; metadata: {status:{privacyStatus:"private"|"unlisted"|"public"}}; status: string; sourceKey: string; sourceHash: string; started?: boolean; session?: string; videoId?: string; progress?: number; actualPrivacy?: "private"|"unlisted"|"public"; privacyCheckedAt?: string };
export function metadata(input: {title:string;description:string;madeForKids:boolean;synthetic:boolean;privacy?:"private"|"unlisted"|"public"}): UploadJob["metadata"];
export class Google {
  stage?: string;
  constructor(client: { client_id: string; client_secret: string }, fetcher?: typeof fetch);
  upload(job: UploadJob, connection: {refreshToken:string}, save:()=>Promise<void>, source:string): Promise<void>;
}

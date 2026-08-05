const JOB_DEFINITION_ARN = /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition\/[A-Za-z0-9_-]+:[1-9][0-9]*$/;
const JOB_QUEUE_ARN = /^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue\/[A-Za-z0-9_-]+$/;

export type ProjectDispatchTarget = {
  jobDefinitionArn: string;
  jobQueueArn: string;
};

function requiredArn(name: string, pattern: RegExp) {
  const value = process.env[name]?.trim() || "";
  if (!pattern.test(value)) {
    throw new Error(`${name} 환경변수가 정확한 AWS ARN으로 설정되지 않았습니다.`);
  }
  return value;
}

export function sourceRangeDispatchTarget(): ProjectDispatchTarget {
  return {
    jobDefinitionArn: requiredArn("SOURCE_RANGE_JOB_DEFINITION_ARN", JOB_DEFINITION_ARN),
    jobQueueArn: requiredArn("SOURCE_RANGE_BATCH_QUEUE_ARN", JOB_QUEUE_ARN),
  };
}

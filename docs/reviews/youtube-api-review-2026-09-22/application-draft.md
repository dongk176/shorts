# API audit application — internal draft, not submitted

Known identity: 아티룸; 김동민; easycut@easycut.co.kr.
Project: 38531581302 / easycut-youtube-prod-260803. Client name: Easy Cut.
Primary URL https://www.easycut.co.kr/en; privacy /privacy; terms /terms.

## Request narrative

We request a YouTube API compliance audit for Easy Cut's optional publishing
integration and removal of the private-only API upload restriction for project
38531581302. OAuth verification for youtube.readonly and youtube.upload was
approved on 22 September 2026. We are not requesting an additional quota increase
at this stage. Public and unlisted uploads remain disabled pending the API audit.

Easy Cut helps creators edit and caption short-form videos. The optional publishing
flow lets users connect a channel they control, select a completed project output,
review the channel and video metadata, and explicitly upload it. The integration
uses channels.list, videos.insert and videos.list for channel identification,
resumable upload and confirmation of the resulting video and actual visibility.

## Access and evidence status

The dedicated non-admin reviewer account and synthetic project 14899 exist.
Credentials are in the ignored private instructions file; do not put them in git
or routine logs. The hosted publishing candidate has not yet been deployed.

The existing 103-second video at https://www.youtube.com/watch?v=HVyqEUeRbuc can be
reused with an explanation that it shows the local implementation. The 88-second
Desktop/youtube.mov is also preserved; no new recording is inherently required.

## Must resolve before a complete submission

1. Environment setup, Google redirect URI, hosted validation and promotion remain
   incomplete. Do not supply the intended review URL as verified working access.
2. The current official form requests full feature access including paid features.
   This account currently has a single publishing fixture and zero generation
   credits. Do not claim that it has unrestricted premium/enterprise access.
3. The form's initial options describe quota increase or requested re-audit. Explain
   the upload-restriction audit purpose accurately; do not invent an invitation or
   requested increase just to choose an option. Confirm the appropriate routing.
4. Organization size/type and designated Google representative remain unconfirmed.
5. The broader service includes YouTube source retrieval/discovery and AI processing.
   If asked for all uses, disclose the actual implementation. Publishing OAuth
   tokens are not passed to ingestion/AI workers. Do not state that publishing is
   the only YouTube use across the service or assert prior written platform
   permission for source retrieval when no evidence has been established.
6. Prepare current public-policy and actual hosted UI screenshots. Local screenshots
   and simulated tests are not evidence of deployment.
7. Complete the demo-account waiver and final accuracy/legal acknowledgments only
   after the owner can review the finished form and required unresolved answers.

Official form rechecked 2026-09-22:
https://support.google.com/youtube/contact/yt_api_form

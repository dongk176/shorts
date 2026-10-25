import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultRankingStyle } from "@/lib/ranking-templates";
import { RankingYouTubeScenePreview } from "./ranking-youtube-scene-preview";

vi.mock("./ranking-overlay", () => ({ RankingOverlay: () => <svg aria-label="ranking design" /> }));
let root: Root;
let container: HTMLElement;
let players: FakePlayer[];
type Events = { onReady: () => void; onStateChange: (event: {data: number}) => void };
class FakePlayer {
  state = 5;
  time = 0;
  muted = false;
  events: Events;
  constructor(_element: HTMLElement, options: {events: Events}) {
    this.events = options.events;
    players.push(this);
    Promise.resolve().then(() => this.events.onReady());
  }
  cueVideoById = vi.fn(({startSeconds}: {startSeconds: number}) => { this.time = startSeconds; });
  seekTo = vi.fn((time: number) => { this.time = time; });
  playVideo = vi.fn(() => { this.state = 1; this.events.onStateChange({data: 1}); });
  pauseVideo = vi.fn(() => { this.state = 2; this.events.onStateChange({data: 2}); });
  getCurrentTime = () => this.time;
  getPlayerState = () => this.state;
  getDuration = () => 30;
  isMuted = () => this.muted;
  mute = () => { this.muted = true; };
  unMute = () => { this.muted = false; };
  destroy = vi.fn();
}
const props = {
  source: {id: "source-1", width: 720, height: 1280, duration: 30, hasAudio: true, previewReady: false,
    remote: {platform: "youtube" as const, videoId: "w-g1AInuLe8", url: "https://www.youtube.com/watch?v=w-g1AInuLe8"}},
  start: 3, end: 10, seek: null, title: "제목", subtitle: "랭킹", count: 4, labels: ["첫 장면"], rank: 1,
  descending: true, style: defaultRankingStyle, suspended: false, pauseSignal: 0, onStart: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  players = [];
  props.onStart.mockClear();
  const {window, document} = parseHTML("<html><body><div id='app'></div></body></html>");
  Object.defineProperty(window, "location", {value: {origin: "https://www.easycut.co.kr"}, configurable: true});
  window.YT = {Player: FakePlayer as unknown as NonNullable<Window['YT']>['Player']};
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn());
  container = document.getElementById("app")!;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<RankingYouTubeScenePreview {...props} />));
  await act(async () => vi.advanceTimersByTime(400));
  return players[0];
}
async function clickPlay() {
  await act(async () => container.querySelector<HTMLButtonElement>(".ranking-preview-toggle")!.click());
}

it("decodes the chosen start through the public embed without a download or thumbnail fallback", async () => {
  const player = await mount();
  expect(player.seekTo).toHaveBeenCalledWith(3, true);
  expect(player.state).toBe(2);
  const iframe = container.querySelector("iframe")!;
  const url = new URL(iframe.src);
  expect(url.hostname).toBe("www.youtube-nocookie.com");
  expect(url.searchParams.get("controls")).toBe("0");
  expect(container.querySelector("img,video")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("원본 열기");
});

it("stops at the selected end and restarts from the selected start", async () => {
  const player = await mount();
  await clickPlay();
  expect(props.onStart).toHaveBeenCalledOnce();
  player.time = 10.01;
  await act(async () => vi.advanceTimersByTime(40));
  expect(player.state).toBe(2);
  expect(container.textContent).toContain("0:07.0 / 0:07.0");
  await clickPlay();
  expect(player.seekTo).toHaveBeenLastCalledWith(3, true);
  expect(player.state).toBe(1);
});

it("updates a dragged range and cursor without recreating the player", async () => {
  const player = await mount();
  await act(async () => root.render(<RankingYouTubeScenePreview {...props} start={8} end={12} seek={{sourceId:"source-1",time:11.966,revision:1}} />));
  await act(async () => vi.advanceTimersByTime(400));
  expect(players).toHaveLength(1);
  expect(player.seekTo).toHaveBeenLastCalledWith(11.966, true);
  expect(player.state).toBe(2);
});

it("ignores a cursor belonging to another rank and pauses when the source player starts", async () => {
  const player = await mount();
  await clickPlay();
  await act(async () => root.render(<RankingYouTubeScenePreview {...props} pauseSignal={1} seek={{sourceId:"source-2",time:25,revision:1}} />));
  expect(player.state).toBe(2);
  expect(player.seekTo).not.toHaveBeenCalledWith(25, true);
});

it("supports Space while leaving text inputs alone", async () => {
  const player = await mount();
  const event = new window.Event("keydown", {bubbles:true,cancelable:true});
  Object.defineProperty(event,"code",{value:"Space"});
  await act(async () => window.dispatchEvent(event));
  expect(player.state).toBe(1);
  const input = document.createElement("input"); container.append(input);
  const typing = new window.Event("keydown",{bubbles:true,cancelable:true});
  Object.defineProperty(typing,"code",{value:"Space"});
  await act(async () => input.dispatchEvent(typing));
  expect(player.state).toBe(1);
});

it("destroys the player while a modal suspends the preview and reconnects on return", async () => {
  const player = await mount();
  await clickPlay();
  await act(async () => root.render(<RankingYouTubeScenePreview {...props} suspended />));
  expect(player.destroy).toHaveBeenCalledOnce();
  expect(container.querySelector<HTMLButtonElement>(".ranking-preview-toggle")!.disabled).toBe(true);
  await act(async () => root.render(<RankingYouTubeScenePreview {...props} />));
  await act(async () => vi.advanceTimersByTime(400));
  expect(players).toHaveLength(2);
  expect(players[1].seekTo).toHaveBeenCalledWith(3, true);
});

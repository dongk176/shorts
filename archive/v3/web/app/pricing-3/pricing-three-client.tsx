"use client";

import Link from "next/link";
import { useState } from "react";
import pricingStyles from "../pricing/pricing.module.css";
import { PricingThreeCheckoutOverlay } from "./pricing-three-checkout-overlay";
import styles from "./pricing-three.module.css";

export type PackageMultiplier = 3 | 6;
export type PackageTier = "starter" | "expert";

export interface UsagePackage {
  code: `${PackageTier}_x${PackageMultiplier}`;
  kind: "package";
  tier: PackageTier;
  multiplier: PackageMultiplier;
  name: string;
  description: string;
  totalMinutes: number;
  totalPriceKrw: number;
  discountPercent: number;
  estimatedShorts: number;
}

export interface MonthlyProduct {
  code: "easycut_pro";
  kind: "subscription";
  name: string;
  totalMinutes: number;
  totalPriceKrw: number;
  estimatedShorts: number;
}

export type PurchaseProduct = UsagePackage | MonthlyProduct;

interface PricingThreeClientProps {
  initialName: string;
  initialEmail: string;
}

const numberFormatter = new Intl.NumberFormat("ko-KR");

const easycutPro: MonthlyProduct = {
  code: "easycut_pro",
  kind: "subscription",
  name: "이지컷 프로",
  totalMinutes: 60,
  totalPriceKrw: 9_900,
  estimatedShorts: 48,
};

const packageCatalog: Record<PackageMultiplier, readonly UsagePackage[]> = {
  3: [
    {
      code: "starter_x3",
      kind: "package",
      tier: "starter",
      multiplier: 3,
      name: "스타터 X3",
      description: "꾸준히 제작하는 크리에이터를 위한 실속 구성입니다.",
      totalMinutes: 600,
      totalPriceKrw: 70_965,
      discountPercent: 5,
      estimatedShorts: 480,
    },
    {
      code: "expert_x3",
      kind: "package",
      tier: "expert",
      multiplier: 3,
      name: "전문가 X3",
      description: "대량 제작자와 운영팀을 위한 넉넉한 구성입니다.",
      totalMinutes: 1_800,
      totalPriceKrw: 147_000,
      discountPercent: 39,
      estimatedShorts: 1_440,
    },
  ],
  6: [
    {
      code: "starter_x6",
      kind: "package",
      tier: "starter",
      multiplier: 6,
      name: "스타터 X6",
      description: "장기 제작을 준비하는 크리에이터를 위한 인기 구성입니다.",
      totalMinutes: 1_200,
      totalPriceKrw: 119_400,
      discountPercent: 20,
      estimatedShorts: 960,
    },
    {
      code: "expert_x6",
      kind: "package",
      tier: "expert",
      multiplier: 6,
      name: "전문가 X6",
      description: "대량 제작자와 운영팀을 위한 최대 용량입니다.",
      totalMinutes: 3_600,
      totalPriceKrw: 288_000,
      discountPercent: 40,
      estimatedShorts: 2_880,
    },
  ],
};

const comparisonRows = [
  {
    label: "총 제공시간",
    values: ["월 60분", "600분", "1,200분", "1,800분", "3,600분"],
  },
  {
    label: "예상 쇼츠 제작량",
    values: ["약 48개/월", "약 480개", "약 960개", "약 1,440개", "약 2,880개"],
  },
  {
    label: "사용량 지급",
    values: ["매월 60분", "구매 즉시 전량", "구매 즉시 전량", "구매 즉시 전량", "구매 즉시 전량"],
  },
  {
    label: "사용 유효기간",
    values: ["월 결제 주기", "12개월", "12개월", "12개월", "12개월"],
  },
  {
    label: "결제 방식",
    values: ["매월 결제", "1회 결제", "1회 결제", "1회 결제", "1회 결제"],
  },
  {
    label: "자동결제",
    values: ["사용", "없음", "없음", "없음", "없음"],
  },
] as const;

export function PricingThreeClient({
  initialName,
  initialEmail,
}: PricingThreeClientProps) {
  const [multiplier, setMultiplier] = useState<PackageMultiplier>(6);
  const [checkoutProduct, setCheckoutProduct] = useState<PurchaseProduct | null>(null);
  const products = packageCatalog[multiplier];

  return (
    <>
      <section className={`hero pricing-hero ${pricingStyles.hero}`}>
        <h1>
          <span>필요한 만큼 선택하고</span>
          <br />
          <span className="pricing-hero-accent">쇼츠 제작에만 집중하세요</span>
        </h1>
      </section>

      <section
        id="pricing-three-plans"
        className={`${pricingStyles.planSection} ${styles.planSection}`}
        aria-label="요금제 선택"
      >
        <div className={pricingStyles.planToolbar}>
          <span>사용량 패키지</span>
          <div
            className={`${pricingStyles.packageTermPicker} ${styles.multiplierPicker}`}
            role="group"
            aria-label="사용량 패키지 배수"
          >
            {([3, 6] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={multiplier === option}
                className={multiplier === option ? pricingStyles.packageTermActive : ""}
                onClick={() => setMultiplier(option)}
              >
                X{option}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.productGrid}>
          <article
            className={`pricing-card ${pricingStyles.planCard} ${pricingStyles.monthlyPlanCard} ${styles.proCard}`}
          >
            <span className={pricingStyles.planEyebrow}>월간 구독</span>
            <div className="pricing-plan-name">
              <h2>{easycutPro.name}</h2>
            </div>
            <div className={`pricing-price ${styles.totalPrice}`}>
              <strong>₩{numberFormatter.format(easycutPro.totalPriceKrw)}</strong>
              <span>/월</span>
            </div>
            <p className="pricing-billing">매월 자동결제 · 월 60분</p>
            <ul>
              <li>
                <span aria-hidden="true">✓</span>
                <div>월 60분 · 원본 영상 처리</div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>쇼츠 약 48개 · 10분 영상 기준</div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>프로젝트 30일 보관</div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>실시간 인기 필터 제공</div>
              </li>
              <li className="pricing-feature-unavailable">
                <span aria-hidden="true">×</span>
                <div>숏폼 전략 가이드 PDF 미제공</div>
              </li>
            </ul>
            <button
              type="button"
              className={`pricing-cta ${pricingStyles.planCta} ${styles.cardCta}`}
              onClick={() => setCheckoutProduct(easycutPro)}
            >
              이지컷 프로 선택
            </button>
          </article>

          <div className={pricingStyles.packageGroup}>
            {products.map((product) => {
              const expert = product.tier === "expert";
              return (
                <article
                  key={product.code}
                  className={`pricing-card ${
                    expert ? "pricing-card-pro" : "pricing-card-popular"
                  } ${pricingStyles.planCard} ${pricingStyles.packagePlanCard} ${styles.packageCard} ${
                    expert ? "" : styles.popularCard
                  }`}
                >
                  {!expert && multiplier === 6 && (
                    <span className="pricing-badge">가장 합리적</span>
                  )}
                  <span
                    className={`${pricingStyles.planEyebrow} ${pricingStyles.discountEyebrow} ${
                      expert ? pricingStyles.discountEyebrowViolet : ""
                    }`}
                  >
                    {product.discountPercent}% 할인
                  </span>
                  <div className="pricing-plan-name">
                    <h2>{product.name}</h2>
                  </div>
                  <p className={pricingStyles.planDescription}>{product.description}</p>
                  <div className={`pricing-price ${styles.totalPrice}`}>
                    <strong>₩{numberFormatter.format(product.totalPriceKrw)}</strong>
                    <span>/1회</span>
                  </div>
                  <ul>
                    <li>
                      <span aria-hidden="true">✓</span>
                      <div>
                        원본 영상 처리{" "}
                        <strong>{numberFormatter.format(product.totalMinutes)}분</strong>
                      </div>
                    </li>
                    <li>
                      <span aria-hidden="true">✓</span>
                      <div>
                        <strong>
                          쇼츠 약 {numberFormatter.format(product.estimatedShorts)}개
                        </strong>
                      </div>
                    </li>
                    <li>
                      <span aria-hidden="true">✓</span>
                      <div>프로젝트 30일 보관</div>
                    </li>
                    <li>
                      <span aria-hidden="true">✓</span>
                      <div>실시간 인기 필터 제공</div>
                    </li>
                    <li>
                      <span aria-hidden="true">✓</span>
                      <div>숏폼 전략 가이드 PDF 다운로드</div>
                    </li>
                  </ul>
                  <button
                    type="button"
                    className={`pricing-cta ${
                      expert ? "" : "pricing-cta-primary"
                    } ${pricingStyles.planCta} ${styles.cardCta}`}
                    onClick={() => setCheckoutProduct(product)}
                  >
                    {product.name} 선택
                  </button>
                </article>
              );
            })}
          </div>
        </div>
        <p className={styles.planFootnote}>
          X3·X6는 기간제가 아닌 사용량 배수입니다. 모든 사용량의 유효기간은 지급일부터 12개월입니다.
        </p>
      </section>

      <section className={styles.beforePurchase} aria-labelledby="before-purchase-heading">
        <div className="pricing-section-heading">
          <h2 id="before-purchase-heading">구매 전 꼭 확인해 주세요</h2>
          <p>결제 전에 서비스 범위와 AI 결과물의 특성을 충분히 확인할 수 있습니다.</p>
        </div>
        <div className={styles.noticeGrid}>
          <article>
            <span aria-hidden="true">01</span>
            <h3>예시 작업 먼저 확인</h3>
            <p>
              템플릿과 예시 결과는 서비스의 일반적인 출력 형태를 안내합니다. 원본 영상과
              설정에 따라 실제 결과는 달라질 수 있습니다.
            </p>
            <Link href="/projects">예시 작업 보기</Link>
          </article>
          <article>
            <span aria-hidden="true">02</span>
            <h3>정상 완료 작업은 사용 처리</h3>
            <p>
              AI 작업이 정상 완료되면 연산 서비스가 제공된 것입니다. 취향 차이, 기대와 다른
              편집 결과 등 주관적 사유로 사용량을 복구하지 않습니다.
            </p>
          </article>
          <article>
            <span aria-hidden="true">03</span>
            <h3>오류 작업은 자동 복구</h3>
            <p>
              서버 오류로 결과물이 생성되지 않은 작업은 차감 사용량을 복구합니다. 광고·계약과
              다른 객관적 하자는 관계 법령과 정책에 따라 처리합니다.
            </p>
          </article>
        </div>
        <p className={styles.legalNote}>
          미사용 잔액은 회사의 임의 환불 대상이 아니며, 관계 법령에 따라 인정되는 청약철회·환불
          권리는 제한하지 않습니다.
        </p>
      </section>

      <section className="pricing-comparison" aria-labelledby="pricing-three-comparison">
        <div className="pricing-section-heading">
          <h2 id="pricing-three-comparison">상품 한눈에 보기</h2>
        </div>
        <div className="pricing-comparison-table-wrap">
          <table className="pricing-comparison-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>이지컷 프로</th>
                <th>스타터 X3</th>
                <th className="pricing-comparison-popular">스타터 X6</th>
                <th>전문가 X3</th>
                <th>전문가 X6</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={`${row.label}-${index}`}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pricing-comparison-note">
          예상 제작량은 평균적인 1분 내외 쇼츠를 기준으로 한 참고치이며 실제 차감량은 원본
          영상 길이와 작업 조건에 따라 달라집니다.
        </p>
      </section>

      {checkoutProduct && (
        <PricingThreeCheckoutOverlay
          product={checkoutProduct}
          initialName={initialName}
          initialEmail={initialEmail}
          onClose={() => setCheckoutProduct(null)}
          onComplete={() => setCheckoutProduct(null)}
        />
      )}
    </>
  );
}

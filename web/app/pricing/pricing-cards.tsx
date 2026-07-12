"use client";

import { useState } from "react";
import Link from "next/link";

const plans = [
  { name: "Plus", icon: "↗", monthly: 9900, minutes: 100, description: "쇼츠 제작을 시작하는 개인 크리에이터", features: ["AI 하이라이트 자동 추출", "월 100분 영상 처리", "쇼츠 자동 자막", "30일 프로젝트 보관"] },
  { name: "Standard", icon: "★", monthly: 19900, minutes: 300, description: "꾸준히 콘텐츠를 만드는 성장형 채널", popular: true, features: ["Plus의 모든 기능", "월 300분 영상 처리", "우선 작업 처리", "고급 쇼츠 템플릿"] },
  { name: "Pro", icon: "◆", monthly: 39900, minutes: 600, description: "여러 채널을 운영하는 전문 크리에이터", pro: true, features: ["Standard의 모든 기능", "월 600분 영상 처리", "최우선 작업 처리", "프로젝트 장기 관리"] },
];

const won = new Intl.NumberFormat("ko-KR");

export function PricingCards() {
  const [yearly, setYearly] = useState(false);
  return (
    <>
      <div className="pricing-toggle" role="group" aria-label="결제 주기">
        <button onClick={() => setYearly(false)} className={!yearly ? "pricing-toggle-active" : ""}>월간 결제</button>
        <button onClick={() => setYearly(true)} className={yearly ? "pricing-toggle-active" : ""}>연간 결제</button>
        <span>20% 할인</span>
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => {
          const displayedMonthly = yearly ? Math.round(plan.monthly * 0.8 / 100) * 100 : plan.monthly;
          const billedYearly = displayedMonthly * 12;
          return (
            <article key={plan.name} className={`pricing-card ${plan.popular ? "pricing-card-popular" : ""}`}>
              {plan.popular && <span className="pricing-badge">가장 인기 있는 플랜</span>}
              {plan.pro && <span className="pricing-badge pricing-badge-violet">전문가를 위한 플랜</span>}
              <div className="pricing-plan-name"><span aria-hidden="true">{plan.icon}</span><h2>{plan.name}</h2></div>
              <p className="pricing-description">{plan.description}</p>
              <div className="pricing-price"><strong>{won.format(displayedMonthly)}원</strong><span>/월</span></div>
              <p className="pricing-billing">{yearly ? `연 ${won.format(billedYearly)}원 결제` : "언제든 변경하거나 해지할 수 있어요"}</p>
              <div className="pricing-capacity"><strong>월 {plan.minutes}분</strong><span>원본 영상 처리</span></div>
              <ul>{plan.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
              <Link href="/#workspace" className={plan.popular ? "pricing-cta pricing-cta-primary" : "pricing-cta"}>{plan.name} 시작하기</Link>
            </article>
          );
        })}
      </div>
    </>
  );
}

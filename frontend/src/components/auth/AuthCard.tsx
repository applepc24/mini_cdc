"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { SocialButtons } from "./SocialButtons";

type AuthView = "login" | "register";

export const AuthCard = () => {
  const [activeView, setActiveView] = useState<AuthView>("login");

  const toggleView = () => {
    setActiveView(activeView === "login" ? "register" : "login");
  };

  return (
    <div className="relative w-full max-w-[720px] h-[500px] bg-card rounded-3xl auth-card-shadow overflow-hidden border-4 border-card">
      {/* Sliding gradient background */}
      <motion.div
        className="absolute top-0 bottom-0 w-1/2 auth-gradient rounded-2xl z-20"
        initial={false}
        animate={{
          x: activeView === "login" ? "100%" : "0%",
        }}
        transition={{
          type: "spring",
          stiffness: 100,
          damping: 20,
          duration: 0.6,
        }}
      />

      {/* Left side - Register Hero / Login Form */}
      <div className="absolute left-0 top-0 w-1/2 h-full">
        <AnimatePresence mode="wait">
          {activeView === "register" ? (
            <motion.div
              key="register-hero"
              className="absolute inset-0 flex flex-col items-center justify-center text-auth-hero z-30 px-8"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <h2 className="text-3xl font-bold mb-4">다시 오셨군요!</h2>
              <p className="text-center opacity-90 mb-6 leading-relaxed">
                기존 계정으로 로그인하여<br />서비스를 계속 이용하세요
              </p>
              <button
                onClick={toggleView}
                className="px-10 py-3 rounded-full border-2 border-auth-hero text-auth-hero bg-transparent font-medium tracking-wide transition-all duration-300 hover:bg-auth-hero hover:text-primary"
              >
                로그인
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="login-form"
              className="absolute inset-0 flex items-center justify-center p-8"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div className="w-full max-w-[280px]">
                <h2 className="text-2xl font-bold text-card-foreground mb-6 text-center">로그인</h2>
                <LoginForm />
                <div className="mt-6">
                  <p className="text-muted-foreground text-sm text-center mb-4">또는 소셜 계정으로</p>
                  <SocialButtons />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right side - Login Hero / Register Form */}
      <div className="absolute right-0 top-0 w-1/2 h-full">
        <AnimatePresence mode="wait">
          {activeView === "login" ? (
            <motion.div
              key="login-hero"
              className="absolute inset-0 flex flex-col items-center justify-center text-auth-hero z-30 px-8"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <h2 className="text-3xl font-bold mb-4">처음이신가요?</h2>
              <p className="text-center opacity-90 mb-6 leading-relaxed">
                계정을 만들고 다양한<br />서비스를 경험해보세요
              </p>
              <button
                onClick={toggleView}
                className="px-10 py-3 rounded-full border-2 border-auth-hero text-auth-hero bg-transparent font-medium tracking-wide transition-all duration-300 hover:bg-auth-hero hover:text-primary"
              >
                회원가입
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="register-form"
              className="absolute inset-0 flex items-center justify-center p-8"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div className="w-full max-w-[280px]">
                <h2 className="text-2xl font-bold text-card-foreground mb-6 text-center">회원가입</h2>
                <RegisterForm onRegistered={() => setActiveView("login")} />
                <div className="mt-6">
                  <p className="text-muted-foreground text-sm text-center mb-4">또는 소셜 계정으로</p>
                  <SocialButtons />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

"use client"

import { Facebook, Twitter, Linkedin } from "lucide-react";

export const SocialButtons = () => {
  const socialButtons = [
    { icon: Facebook, label: "Facebook" },
    { icon: Twitter, label: "Twitter" },
    { icon: Linkedin, label: "LinkedIn" },
  ];

  return (
    <div className="flex justify-center gap-3">
      {socialButtons.map(({ icon: Icon, label }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          className="w-11 h-11 rounded-full bg-auth-social flex items-center justify-center text-muted-foreground transition-all duration-300 hover:bg-auth-social-hover hover:text-primary-foreground hover:scale-110"
        >
          <Icon className="w-5 h-5" />
        </button>
      ))}
    </div>
  );
};

"use client";

import { useMemo, useState } from "react";
import type React from "react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCategories } from "@/lib/mock/products";
import type {
  Product,
  ProductCreateInput,
  ProductUpdateInput,
} from "@/lib/types";

type SubmitPayload = ProductCreateInput | ProductUpdateInput;

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SubmitPayload) => void;
  product?: Product | null;
}

type FormData = {
  name: string;
  category: string;
  price: string;
  qty: string;
};

export function ProductFormModal({
  isOpen,
  onClose,
  onSubmit,
  product,
}: ProductFormModalProps) {
  const categories = getCategories();
  const isEditMode = !!product;

  // ✅ product / categories 기반 "초기값"만 계산
  const initialFormData = useMemo<FormData>(() => {
    if (product) {
      return {
        name: product.name,
        category: product.category,
        price: String(product.price),
        qty: String(product.qty),
      };
    }

    return {
      name: "",
      category: categories[0] ?? "",
      price: "",
      qty: "",
    };
  }, [product, categories]);

  // ✅ state는 초기값으로만 세팅 (리마운트되면 자동 초기화됨)
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = "이름을 입력해 주세요";
    if (!formData.category) newErrors.category = "카테고리를 선택해 주세요";
    if (!formData.price || Number(formData.price) <= 0) {
      newErrors.price = "유효한 가격을 입력해 주세요";
    }

    // ✅ 생성 모드일 때만 qty 검사
    if (!isEditMode) {
      if (formData.qty === "" || Number(formData.qty) < 0) {
        newErrors.qty = "유효한 수량을 입력해 주세요";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleClose = () => {
    // ✅ 닫을 때 에러만 정리 (setState in effect 아니고 이벤트 핸들러라 OK)
    setErrors({});
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (isEditMode) {
      const payload: ProductUpdateInput = {
        name: formData.name.trim(),
        category: formData.category,
        price: Number(formData.price),
      };
      onSubmit(payload);
    } else {
      const payload: ProductCreateInput = {
        name: formData.name.trim(),
        category: formData.category,
        price: Number(formData.price),
        qty: Number(formData.qty),
      };
      onSubmit(payload);
    }

    handleClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditMode ? "제품 수정" : "새 제품 추가"}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">제품명</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => {
              const v = e.target.value;
              setFormData((prev) => ({ ...prev, name: v }));
              if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
            }}
            placeholder="제품명을 입력하세요"
            className={errors.name ? "border-red-500" : ""}
          />
          {errors.name && (
            <p className="text-sm text-red-500 mt-1">{errors.name}</p>
          )}
        </div>

        <div>
          <Label htmlFor="category">카테고리</Label>
          <select
            id="category"
            value={formData.category}
            onChange={(e) => {
              const v = e.target.value;
              setFormData((prev) => ({ ...prev, category: v }));
              if (errors.category) setErrors((prev) => ({ ...prev, category: "" }));
            }}
            className={`w-full h-10 px-3 bg-background border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 ${
              errors.category ? "border-red-500" : "border-input"
            }`}
          >
            <option value="">카테고리 선택</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          {errors.category && (
            <p className="text-sm text-red-500 mt-1">{errors.category}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="price">가격</Label>
            <Input
              id="price"
              type="number"
              value={formData.price}
              onChange={(e) => {
                const v = e.target.value;
                setFormData((prev) => ({ ...prev, price: v }));
                if (errors.price) setErrors((prev) => ({ ...prev, price: "" }));
              }}
              placeholder="0"
              className={errors.price ? "border-red-500" : ""}
            />
            {errors.price && (
              <p className="text-sm text-red-500 mt-1">{errors.price}</p>
            )}
          </div>

          {!isEditMode && (
            <div>
              <Label htmlFor="qty">수량</Label>
              <Input
                id="qty"
                type="number"
                value={formData.qty}
                onChange={(e) => {
                  const v = e.target.value;
                  setFormData((prev) => ({ ...prev, qty: v }));
                  if (errors.qty) setErrors((prev) => ({ ...prev, qty: "" }));
                }}
                placeholder="0"
                className={errors.qty ? "border-red-500" : ""}
              />
              {errors.qty && (
                <p className="text-sm text-red-500 mt-1">{errors.qty}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            className="flex-1 bg-transparent"
            onClick={handleClose}
          >
            취소
          </Button>
          <Button type="submit" className="flex-1">
            {isEditMode ? "변경사항 저장" : "제품 추가"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

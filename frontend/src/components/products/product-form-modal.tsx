"use client";

import { useState, useEffect } from "react";
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
  onSubmit: (data: SubmitPayload) => void; // ✅ 생성/수정 모두 받기
  product?: Product | null;
}

export function ProductFormModal({
  isOpen,
  onClose,
  onSubmit,
  product,
}: ProductFormModalProps) {
  const categories = getCategories();

  const [formData, setFormData] = useState({
    name: "",
    category: categories[0] ?? "",
    price: "",
    qty: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEditMode = !!product; // ✅ 수정 모드 여부

  useEffect(() => {
    if (!isOpen) return;

    if (product) {
      setFormData({
        name: product.name,
        category: product.category,
        price: String(product.price),
        qty: String(product.qty), // 수정 모드에서는 화면에 안 보여도 값은 유지 가능
      });
    } else {
      setFormData({
        name: "",
        category: categories[0] ?? "",
        price: "",
        qty: "",
      });
    }

    setErrors({});
  }, [product, isOpen, categories]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = "이름을 입력해 주세요";
    if (!formData.category) newErrors.category = "카테고리를 선택해 주세요";
    if (!formData.price || Number(formData.price) <= 0)
      newErrors.price = "유효한 가격을 입력해 주세요";

    // ✅ 생성 모드일 때만 qty 검사
    if (!isEditMode) {
      if (formData.qty === "" || Number(formData.qty) < 0)
        newErrors.qty = "유효한 수량을 입력해 주세요";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (isEditMode) {
      // ✅ 수정: qty 없이 전송
      const payload: ProductUpdateInput = {
        name: formData.name.trim(),
        category: formData.category,
        price: Number(formData.price),
      };
      onSubmit(payload);
    } else {
      // ✅ 생성: qty 포함 전송
      const payload: ProductCreateInput = {
        name: formData.name.trim(),
        category: formData.category,
        price: Number(formData.price),
        qty: Number(formData.qty),
      };
      onSubmit(payload);
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? "제품 수정" : "새 제품 추가"}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">제품명</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
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
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, category: e.target.value }))
            }
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
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, price: e.target.value }))
              }
              placeholder="0"
              className={errors.price ? "border-red-500" : ""}
            />
            {errors.price && (
              <p className="text-sm text-red-500 mt-1">{errors.price}</p>
            )}
          </div>

          {/* ✅ 생성 모드일 때만 qty 입력 보여주기 */}
          {!isEditMode && (
            <div>
              <Label htmlFor="qty">수량</Label>
              <Input
                id="qty"
                type="number"
                value={formData.qty}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, qty: e.target.value }))
                }
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
            onClick={onClose}
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

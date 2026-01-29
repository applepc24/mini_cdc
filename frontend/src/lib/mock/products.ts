import type { Product } from '@/lib/types'

const categories = [
  'Electronics',
  'Clothing',
  'Food & Beverages',
  'Home & Garden',
  'Sports & Outdoors',
  'Books & Media',
  'Health & Beauty',
  'Toys & Games',
  'Automotive',
  'Office Supplies'
]

const productNames: Record<string, string[]> = {
  'Electronics': ['Wireless Mouse', 'Bluetooth Speaker', 'USB-C Hub', 'Webcam HD', 'Mechanical Keyboard', 'Monitor Stand', 'Power Bank', 'Smart Watch', 'Earbuds Pro', 'Tablet Stand'],
  'Clothing': ['Cotton T-Shirt', 'Denim Jeans', 'Winter Jacket', 'Running Shoes', 'Wool Sweater', 'Casual Shorts', 'Dress Shirt', 'Sneakers', 'Baseball Cap', 'Leather Belt'],
  'Food & Beverages': ['Organic Coffee', 'Green Tea', 'Protein Bar', 'Almond Milk', 'Olive Oil', 'Dark Chocolate', 'Energy Drink', 'Trail Mix', 'Coconut Water', 'Granola'],
  'Home & Garden': ['LED Bulb', 'Plant Pot', 'Throw Pillow', 'Scented Candle', 'Wall Clock', 'Picture Frame', 'Door Mat', 'Storage Box', 'Garden Gloves', 'Watering Can'],
  'Sports & Outdoors': ['Yoga Mat', 'Dumbbell Set', 'Tennis Racket', 'Camping Tent', 'Hiking Backpack', 'Water Bottle', 'Jump Rope', 'Resistance Band', 'Soccer Ball', 'Bike Helmet'],
  'Books & Media': ['Fiction Novel', 'Cookbook', 'Self-Help Book', 'Vinyl Record', 'Art Magazine', 'Journal Notebook', 'Comic Book', 'Audiobook Card', 'Photo Album', 'Calendar'],
  'Health & Beauty': ['Face Cream', 'Shampoo', 'Sunscreen SPF50', 'Vitamin C Serum', 'Hand Sanitizer', 'Lip Balm', 'Body Lotion', 'Toothpaste', 'Hair Oil', 'Face Mask'],
  'Toys & Games': ['Building Blocks', 'Board Game', 'Puzzle 1000pc', 'Action Figure', 'Remote Control Car', 'Stuffed Animal', 'Card Game', 'Chess Set', 'Drone Mini', 'Art Kit'],
  'Automotive': ['Car Charger', 'Phone Mount', 'Dash Cam', 'Air Freshener', 'Seat Cover', 'Tire Gauge', 'Jump Starter', 'Tool Kit', 'Cleaning Cloth', 'Sun Shade'],
  'Office Supplies': ['Notebook A5', 'Pen Set', 'Stapler', 'Desk Organizer', 'Sticky Notes', 'Scissors', 'Paper Clips', 'Highlighter Set', 'Mouse Pad', 'Cable Organizer']
}

function generateRandomDate(daysBack: number): string {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack))
  date.setHours(Math.floor(Math.random() * 24))
  date.setMinutes(Math.floor(Math.random() * 60))
  return date.toISOString()
}

function generateProducts(): Product[] {
  const products: Product[] = []
  let id = 1

  categories.forEach(category => {
    const names = productNames[category]
    names.forEach(name => {
      // Generate varied stock quantities with some outliers
      let qty: number
      const rand = Math.random()
      if (rand < 0.05) {
        qty = 0 // 5% out of stock
      } else if (rand < 0.15) {
        qty = Math.floor(Math.random() * 5) + 1 // 10% danger zone
      } else if (rand < 0.30) {
        qty = Math.floor(Math.random() * 5) + 5 // 15% warning zone
      } else {
        qty = Math.floor(Math.random() * 200) + 10 // Normal stock
      }

      products.push({
        product_id: `PRD-${String(id).padStart(4, '0')}`,
        name: `${name} ${category.charAt(0)}${id}`,
        category,
        price: Math.round((Math.random() * 500 + 5) * 100) / 100,
        qty,
        updated_at: generateRandomDate(30)
      })
      id++
    })
  })

  return products
}

export const mockProducts = generateProducts()

export function getProductById(id: string): Product | undefined {
  return mockProducts.find(p => p.product_id === id)
}

export function getCategories(): string[] {
  return categories
}
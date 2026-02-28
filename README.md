# samsung-feed-fix

Автоматический фиксер Google Shopping фида Samsung KZ.

## Что исправляет

1. **`mobile_link`** — копирует из `link` (вместо главной страницы `/kz`)
2. **`google_product_category`** — заменяет на официальную таксономию Google
3. **Ссылки S26** — переписывает на buy-страницу с `modelCode`

## Фид

Исправленный фид доступен по адресу:
```
https://<username>.github.io/samsung-feed-fix/google-shopping.xml
```

Обновляется автоматически каждые **30 минут**.

## Локальный запуск

```bash
npm install
GOOGLE_FEED_URL="https://shop.samsung.com/kz_ru/googleShoppingFeed" npm run build
# результат → public/google-shopping.xml
```

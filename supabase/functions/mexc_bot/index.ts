import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log(`Function "mexc_bot" up and running!`);

const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const bot = new Bot(Deno.env.get("MEXC_BOT_TOKEN") || "");

// MEXC API Configuration
const MEXC_API_BASE = "https://contract.mexc.com";

// User-Agent to emulate browser
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Helper function for fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

// Helper function to safely send Telegram messages
async function safeReply(ctx: any, message: string, options?: any): Promise<void> {
  try {
    await ctx.reply(message, options);
  } catch (error: any) {
    console.error(`❌ Помилка при відправці повідомлення в Telegram:`, error?.message || error);
    // Try to send a shorter error message
    try {
      await ctx.reply(`⚠️ Помилка: ${error?.message || 'Невідома помилка'}`);
    } catch (retryError) {
      console.error(`❌ Критична помилка: не вдалося відправити повідомлення в Telegram`);
    }
  }
}

// Helper function to safely send curl command (with length limit)
async function safeSendCurlCommand(ctx: any, curlCommand: string): Promise<void> {
  const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
  const PREFIX = `📋 Curl команда для тестування в Postman:\n\n\`\`\`\n`;
  const SUFFIX = `\n\`\`\`\n\n💡 Скопіюйте команду вище та вставте в Postman (Import -> Raw text)`;
  const MAX_CURL_LENGTH = TELEGRAM_MAX_MESSAGE_LENGTH - PREFIX.length - SUFFIX.length - 100; // 100 for safety margin
  
  let finalCurlCommand = curlCommand;
  let truncated = false;
  
  if (curlCommand.length > MAX_CURL_LENGTH) {
    finalCurlCommand = curlCommand.substring(0, MAX_CURL_LENGTH - 50) + '\n... (команда обрізана, занадто довга)';
    truncated = true;
  }
  
  const message = `${PREFIX}${finalCurlCommand}${SUFFIX}${truncated ? '\n\n⚠️ Команда була обрізана через обмеження Telegram. Cookies не включені в команду, але додаються автоматично до запиту.' : ''}`;
  
  await safeReply(ctx, message, { parse_mode: "Markdown" });
}

// Helper function to create HMAC SHA256 signature for MEXC API
// According to MEXC API documentation:
// For POST requests: accessKey + timestamp + paramString (where paramString = bodyJsonString)
// For GET/DELETE requests: accessKey + timestamp + sorted query params
// Signature = hex(hmac_sha256(secretKey, signTarget))
async function createMEXCSignature(
  apiSecret: string,
  apiKey: string,
  timestamp: string,
  body?: string,
  queryParams?: Record<string, string>
): Promise<string> {
  let targetString: string;
  
  if (body) {
    // POST request: accessKey + timestamp + bodyJsonString
    targetString = apiKey + timestamp + body;
    console.log(`🔐 [SIGNATURE] POST format: accessKey + timestamp + body`);
  } else if (queryParams && Object.keys(queryParams).length > 0) {
    // GET/DELETE request: accessKey + timestamp + sorted query params
    const sortedParams = Object.keys(queryParams)
      .sort()
      .map((key) => `${key}=${queryParams[key]}`)
      .join("&");
    targetString = apiKey + timestamp + sortedParams;
    console.log(`🔐 [SIGNATURE] GET/DELETE format: accessKey + timestamp + sorted params`);
  } else {
    // No parameters: accessKey + timestamp
    targetString = apiKey + timestamp;
    console.log(`🔐 [SIGNATURE] No params format: accessKey + timestamp`);
  }
  
  console.log(`🔐 [SIGNATURE DEBUG] Target string for signing:`, targetString.substring(0, 300) + (targetString.length > 300 ? '...' : ''));
  
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiSecret);
  const messageData = encoder.encode(targetString);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  
  return hashHex;
}

// Convert symbol format from "XRPUSDT" to "XRP_USDT" for MEXC API
function convertSymbolFormat(symbol: string): string {
  // If symbol already has underscore, return as is
  if (symbol.includes('_')) {
    return symbol;
  }
  
  // Try to find USDT, USDC, USD, etc. at the end and add underscore before it
  const suffixes = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
  for (const suffix of suffixes) {
    if (symbol.endsWith(suffix) && symbol.length > suffix.length) {
      return symbol.slice(0, -suffix.length) + '_' + suffix;
    }
  }
  
  // If no suffix found, return as is
  return symbol;
}

// Get current price for a symbol
async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    // Convert symbol format (e.g., "XRPUSDT" -> "XRP_USDT")
    const mexcSymbol = convertSymbolFormat(symbol);
    
    // Fetch ticker data - this endpoint returns all tickers, we need to find our symbol
    const response = await fetchWithTimeout(`${MEXC_API_BASE}/api/v1/contract/ticker`, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    }, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`Price API response for ${symbol} (converted to ${mexcSymbol}):`, JSON.stringify(data).substring(0, 500));
    
    // Check if response is successful
    if (data.success === true && data.code === 0 && Array.isArray(data.data)) {
      // Find the ticker for our symbol
      const ticker = data.data.find((item: any) => item.symbol === mexcSymbol);
      
      if (ticker && ticker.lastPrice) {
        const price = parseFloat(ticker.lastPrice);
        if (!isNaN(price) && price > 0) {
          console.log(`Found price for ${symbol} (${mexcSymbol}): ${price}`);
          return price;
        }
      } else {
        console.error(`Symbol ${symbol} (${mexcSymbol}) not found in ticker data. Available symbols: ${data.data.slice(0, 5).map((item: any) => item.symbol).join(', ')}...`);
      }
    } else {
      console.error(`MEXC API error for ${symbol}: code=${data.code}, message=${data.message || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error(`Error fetching price for ${symbol}:`, error?.message || error);
  }
  
  return null;
}

// Get contract details including apiAllowed field
async function getContractDetail(symbol: string): Promise<{ success: boolean; detail?: any; message?: string }> {
  try {
    const mexcSymbol = convertSymbolFormat(symbol);
    console.log(`📋 Отримання деталей контракту для ${symbol} (${mexcSymbol})...`);
    
    const response = await fetchWithTimeout(`${MEXC_API_BASE}/api/v1/contract/detail?symbol=${mexcSymbol}`, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    }, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return {
        success: false,
        message: `Помилка HTTP: ${response.status}`,
      };
    }
    
    const data = await response.json();
    
    if (data.success === true && data.code === 0 && data.data) {
      console.log(`✅ Отримано деталі контракту для ${mexcSymbol}`);
      return {
        success: true,
        detail: data.data,
      };
    } else {
      console.error(`MEXC API error: code=${data.code}, message=${data.message || 'Unknown error'}`);
      return {
        success: false,
        message: `Помилка API: ${data.message || 'Невідома помилка'}`,
      };
    }
  } catch (error: any) {
    console.error(`Error fetching contract detail:`, error?.message || error);
    return {
      success: false,
      message: `Помилка: ${error?.message || 'Невідома помилка'}`,
    };
  }
}

// Get list of available contracts for trading
async function getAvailableContracts(): Promise<{ success: boolean; contracts?: any[]; message?: string }> {
  try {
    console.log('📋 Отримання списку доступних контрактів...');
    
    const response = await fetchWithTimeout(`${MEXC_API_BASE}/api/v1/contract/ticker`, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    }, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return {
        success: false,
        message: `Помилка HTTP: ${response.status}`,
      };
    }
    
    const data = await response.json();
    
    if (data.success === true && data.code === 0 && Array.isArray(data.data)) {
      console.log(`✅ Отримано ${data.data.length} контрактів`);
      return {
        success: true,
        contracts: data.data,
      };
    } else {
      console.error(`MEXC API error: code=${data.code}, message=${data.message || 'Unknown error'}`);
      return {
        success: false,
        message: `Помилка API: ${data.message || 'Невідома помилка'}`,
      };
    }
  } catch (error: any) {
    console.error(`Error fetching contracts:`, error?.message || error);
    return {
      success: false,
      message: `Помилка: ${error?.message || 'Невідома помилка'}`,
    };
  }
}

// Set leverage for a symbol
async function setLeverage(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  leverage: number
): Promise<boolean> {
  console.log(`⚙️  [SET LEVERAGE] Початок встановлення плеча`);
  console.log(`   Symbol: ${symbol}, Leverage: ${leverage}`);
  
  try {
    // Convert symbol format (e.g., "XRPUSDT" -> "XRP_USDT")
    const mexcSymbol = convertSymbolFormat(symbol);
    console.log(`   Converted symbol: ${mexcSymbol}`);
    
    // MEXC requires timestamp in milliseconds (not seconds!)
    const timestamp = Date.now().toString();
    const path = "/api/v1/private/position/change_leverage";
    const url = `${MEXC_API_BASE}${path}`;
    const requestBody = {
      symbol: mexcSymbol,
      leverage: leverage.toString(),
    };
    const bodyString = JSON.stringify(requestBody);

    // Signature format: accessKey + timestamp + bodyJsonString
    const signature = await createMEXCSignature(apiSecret, apiKey, timestamp, bodyString);
    console.log(`   Signature created: ${signature.substring(0, 20)}...`);
    
    console.log(`   URL: ${url}`);
    console.log(`   Request Body:`, JSON.stringify(requestBody));

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ApiKey": apiKey,
        "Request-Time": timestamp,
        "Signature": signature,
        "Recv-Window": "5000",
        "User-Agent": USER_AGENT,
      },
      body: bodyString, // Use the same body string that was used for signature
    }, REQUEST_TIMEOUT);

    console.log(`   Response status: ${response.status}`);
    const responseText = await response.text();
    console.log(`   Response:`, responseText.substring(0, 200));
    
    const data = JSON.parse(responseText);
    const success = data.code === 0;
    
    if (success) {
      console.log(`✅ [SET LEVERAGE] Плече успішно встановлено`);
    } else {
      console.error(`❌ [SET LEVERAGE] Помилка: code=${data.code}, message=${data.message || 'N/A'}`);
    }
    
    return success;
  } catch (error: any) {
    console.error(`❌ [SET LEVERAGE] Помилка:`, error?.message || error);
    return false;
  }
}

// Close a position on MEXC
async function closeMEXCPosition(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  positionType: "ISOLATED" | "CROSS" = "ISOLATED",
  cookies?: string
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    // Convert symbol format (e.g., "XRPUSDT" -> "XRP_USDT")
    const mexcSymbol = convertSymbolFormat(symbol);
    
    // MEXC requires timestamp in milliseconds (not seconds!)
    const timestamp = Date.now().toString();
    const path = "/api/v1/private/position/flat_all";
    
    // Prepare request body
    const requestBody: any = {
      symbol: mexcSymbol,
      positionType,
    };
    const bodyString = JSON.stringify(requestBody);

    // Signature format: accessKey + timestamp + bodyJsonString
    const signature = await createMEXCSignature(apiSecret, apiKey, timestamp, bodyString);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "ApiKey": apiKey,
      "Request-Time": timestamp,
      "Signature": signature,
      "Recv-Window": "5000",
      "User-Agent": USER_AGENT,
    };

    // Add cookies if provided
    if (cookies) {
      try {
        // Clean cookies - remove any invalid characters that might cause header issues
        // Remove newlines, carriage returns, and other control characters
        let cleanedCookies = cookies.replace(/[\r\n\t]/g, '').trim();
        
        // Remove any null bytes or other problematic characters
        cleanedCookies = cleanedCookies.replace(/\0/g, '');
        
        // Check if cookies are too long (HTTP headers have limits)
        const MAX_COOKIE_LENGTH = 8192; // Typical HTTP header limit
        if (cleanedCookies.length > MAX_COOKIE_LENGTH) {
          console.warn(`   ⚠️  Cookies занадто довгі (${cleanedCookies.length} символів), обрізаю до ${MAX_COOKIE_LENGTH}`);
          cleanedCookies = cleanedCookies.substring(0, MAX_COOKIE_LENGTH);
        }
        
        // Validate cookie string (basic check)
        if (cleanedCookies.length > 0) {
          headers["Cookie"] = cleanedCookies;
          console.log(`   ✅ Cookies додано до запиту (довжина: ${cleanedCookies.length} символів)`);
        } else {
          console.warn(`   ⚠️  Cookies порожні після очищення, пропускаю`);
        }
      } catch (error: any) {
        console.error(`   ❌ Помилка при обробці cookies: ${error?.message}`);
        console.warn(`   ⚠️  Продовжую без cookies`);
      }
    }

    const response = await fetchWithTimeout(`${MEXC_API_BASE}${path}`, {
      method: "POST",
      headers: headers,
      body: bodyString, // Use the same body string that was used for signature
    }, REQUEST_TIMEOUT);

    const data = await response.json();

    if (data.code === 0) {
      return {
        success: true,
        message: "Позицію успішно закрито",
        data: data.data,
      };
    } else {
      return {
        success: false,
        message: data.message || `Помилка API: ${data.code}`,
        data: data,
      };
    }
  } catch (error: any) {
    console.error("Error closing position:", error);
    return {
      success: false,
      message: `Помилка: ${error?.message || 'Невідома помилка'}`,
    };
  }
}

// Helper function to format error message from MEXC API response
function formatMEXCError(data: any, defaultMessage: string): string {
  if (!data) return defaultMessage;
  
  // Common MEXC error codes and their meanings
  const errorMessages: Record<number, string> = {
    400: "Невірний запит - перевірте параметри",
    401: "Помилка автентифікації - перевірте API ключі",
    403: "Доступ заборонено - перевірте права API ключа",
    404: "Ресурс не знайдено",
    429: "Занадто багато запитів - спробуйте пізніше",
    500: "Внутрішня помилка сервера MEXC",
    503: "Сервіс тимчасово недоступний",
    1002: "Ф'ючерсний контракт не активований для цього акаунта",
    2007: "Помилка ціни ордера - перевірте формат та значення ціни",
    602: "Помилка підпису - перевірте правильність API ключів та підпису",
  };

  let message = defaultMessage;
  
  // Try to get detailed error message
  if (data.message) {
    message = data.message;
  } else if (data.code && errorMessages[data.code]) {
    message = errorMessages[data.code];
    if (data.msg) {
      message += `: ${data.msg}`;
    }
  } else if (data.msg) {
    message = data.msg;
  } else if (data.error) {
    message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
  }

  // Check for precision error in message
  if (message && (message.toLowerCase().includes('precision') || message.toLowerCase().includes('quantity precision') || message.toLowerCase().includes('price precision'))) {
    message += `\n\n📋 Як вирішити помилку precision:\n` +
               `• Перевірте точність кількості (vol) - вона повинна відповідати вимогам символу\n` +
               `• Перевірте точність ціни (якщо використовується)\n` +
               `• Бот автоматично отримує precision з API, але якщо помилка повторюється, спробуйте зменшити кількість знаків після коми\n` +
               `• Використайте /contract <symbol> для перевірки деталей контракту`;
  }

  // Add additional context if available
  if (data.code) {
    message += ` (код помилки: ${data.code})`;
    
    // Add detailed instructions for specific error codes
    if (data.code === 1002) {
      message += `\n\n📋 Як вирішити:\n` +
                 `1. Увійдіть на MEXC через веб-сайт або мобільний додаток\n` +
                 `2. Перейдіть в розділ "Ф'ючерси" (Futures)\n` +
                 `3. Активуйте ф'ючерсний контракт для вашого акаунта\n` +
                 `4. Переконайтеся, що у вас є достатньо балансу для торгівлі\n` +
                 `5. Після активації спробуйте відкрити позицію знову`;
    } else if (data.code === 2007) {
      message += `\n\n📋 Можливі причини:\n` +
                 `• Неправильний формат ціни\n` +
                 `• Ціна занадто висока або занадто низька\n` +
                 `• Ціна не відповідає поточному ринку\n` +
                 `• Перевірте, чи символ підтримує вказану ціну\n` +
                 `• Можлива помилка precision - перевірте точність ціни`;
    } else if (data.code === 602) {
      message += `\n\n📋 Можливі причини:\n` +
                 `• Неправильний API Secret Key\n` +
                 `• Неправильний формат підпису\n` +
                 `• Неправильний timestamp\n` +
                 `• Перевірте правильність API ключів`;
    }
  }

  return message;
}

// Open a position on MEXC
async function openMEXCPosition(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: "long" | "short",
  quantity: number,
  leverage?: number,
  orderType: "MARKET" = "MARKET",
  price?: number,
  cookies?: string
): Promise<{ success: boolean; message: string; data?: any; curlCommand?: string }> {
  console.log('='.repeat(80));
  console.log('🚀 [OPEN POSITION] Початок відкриття позиції');
  console.log('📥 Вхідні параметри:', {
    symbol,
    side,
    quantity,
    leverage: leverage || 'не вказано',
    orderType,
    price: price || 'не вказано',
    apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'не вказано',
  });
  
  // Convert symbol format (e.g., "XRPUSDT" -> "XRP_USDT")
  const mexcSymbol = convertSymbolFormat(symbol);
  console.log(`🔄 Конвертація символу: "${symbol}" -> "${mexcSymbol}"`);
  
  try {
    // Set leverage if provided
    if (leverage) {
      console.log(`⚙️  Встановлення плеча: ${leverage} для ${mexcSymbol}`);
      const leverageSet = await setLeverage(apiKey, apiSecret, mexcSymbol, leverage);
      if (!leverageSet) {
        console.warn(`⚠️  Не вдалося встановити плече ${leverage}, продовжую без зміни плеча`);
        // Continue anyway, leverage might already be set
      } else {
        console.log(`✅ Плече ${leverage} успішно встановлено`);
      }
      // Small delay after setting leverage
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // MEXC requires timestamp in MILLISECONDS (not seconds!)
    const timestamp = Date.now().toString();
    const path = "/api/v1/private/order/create";
    console.log(`⏰ Timestamp (milliseconds): ${timestamp}`);
    
    // Map position type: "ISOLATED" -> 1, "CROSS" -> 2
    const openType: 1 | 2 = 2; // 1 = isolated, 2 = cross (using CROSS by default)
    
    // Map side according to MEXC API:
    // 1 = open long, 2 = close short, 3 = open short, 4 = close long
    // We only use open positions: 1 for long, 3 for short
    const sideInt = side === "long" ? 1 : 3;
    
    // All orders are MARKET orders (type=5)
    const typeInt = 5; // MARKET order

    console.log(`📝 Підготовка запиту:`);
    console.log(`   Timestamp: ${timestamp} (milliseconds)`);
    console.log(`   Path: ${path}`);
    console.log(`   Open Type: ${openType} (cross)`);
    console.log(`   Side: ${sideInt} (${sideInt === 1 ? 'open long' : sideInt === 3 ? 'open short' : 'N/A'})`);
    console.log(`   Type: ${typeInt} (market)`);

    // Get contract details to determine precision for vol
    // Use more conservative default precision (4-6 digits) to avoid precision errors
    let volPrecision = 4; // Default precision - more conservative
    try {
      const contractDetail = await getContractDetail(symbol);
      if (contractDetail.success && contractDetail.detail) {
        console.log(`   Contract detail keys:`, Object.keys(contractDetail.detail));
        
        // Try different possible fields for precision
        if (contractDetail.detail.quantityPrecision !== undefined) {
          volPrecision = parseInt(contractDetail.detail.quantityPrecision);
          console.log(`   ✅ Quantity precision from API: ${volPrecision}`);
        } else if (contractDetail.detail.volPrecision !== undefined) {
          volPrecision = parseInt(contractDetail.detail.volPrecision);
          console.log(`   ✅ Vol precision from API: ${volPrecision}`);
        } else if (contractDetail.detail.precision !== undefined) {
          volPrecision = parseInt(contractDetail.detail.precision);
          console.log(`   ✅ Precision from API: ${volPrecision}`);
        } else if (contractDetail.detail.minQty !== undefined) {
          // Calculate precision from minQty (e.g., 0.0001 -> 4 decimal places)
          const minQty = parseFloat(contractDetail.detail.minQty);
          if (minQty > 0) {
            const minQtyStr = minQty.toString();
            const decimalPart = minQtyStr.split('.')[1];
            if (decimalPart) {
              // Count trailing zeros to determine precision
              const trailingZeros = decimalPart.match(/0+$/)?.[0]?.length || 0;
              volPrecision = decimalPart.length - trailingZeros;
              console.log(`   ✅ Calculated precision from minQty (${minQty}): ${volPrecision}`);
            }
          }
        } else {
          console.log(`   ⚠️  Precision not found in API response, using default: ${volPrecision}`);
          console.log(`   Full contract detail:`, JSON.stringify(contractDetail.detail).substring(0, 500));
        }
      } else {
        console.warn(`   ⚠️  Не вдалося отримати деталі контракту, використовую default: ${volPrecision}`);
      }
    } catch (error: any) {
      console.warn(`   ⚠️  Помилка при отриманні precision з API: ${error?.message}, використовую default: ${volPrecision}`);
    }

    // Ensure precision is within reasonable bounds (1-8)
    volPrecision = Math.max(1, Math.min(8, volPrecision));
    
    // Round vol to the correct precision
    const volRounded = parseFloat(quantity.toFixed(volPrecision));
    console.log(`   📊 Vol calculation: ${quantity} -> ${volRounded} (precision: ${volPrecision} decimal places)`);
    
    // Prepare request body according to MEXC API documentation
    // For market orders (type=5), price is not required and should not be sent
    const requestBody: any = {
      symbol: mexcSymbol,
      vol: volRounded.toString(),
      side: sideInt,
      type: typeInt,
      openType: openType,
    };

    console.log(`   Market order (type=5) - price не передається`);

    // Add leverage if provided
    if (leverage) {
      requestBody.leverage = leverage;
    }

    // Remove null/undefined values from body (according to MEXC docs: "Business parameters that are null are not included in the signature")
    const cleanedBody: any = {};
    for (const [key, value] of Object.entries(requestBody)) {
      if (value !== null && value !== undefined) {
        cleanedBody[key] = value;
      }
    }

    console.log(`📦 Request Body:`, JSON.stringify(cleanedBody, null, 2));

    // Create signature according to MEXC API documentation:
    // signature = hex(hmac_sha256(secretKey, signTarget))
    // where signTarget = accessKey + timestamp + paramString
    // For POST: accessKey + timestamp + bodyJsonString
    // JSON must be compact (no spaces) and without null values
    const bodyString = JSON.stringify(cleanedBody);
    console.log(`🔐 Створення підпису...`);
    console.log(`   Body string: ${bodyString}`);
    console.log(`   Timestamp: ${timestamp} (milliseconds)`);
    console.log(`   API Key: ${apiKey.substring(0, 8)}...`);
    console.log(`   Format: accessKey + timestamp + body`);
    
    // Create signature: accessKey + timestamp + body JSON string
    const signature = await createMEXCSignature(apiSecret, apiKey, timestamp, bodyString);
    console.log(`   ✅ Signature created: ${signature.substring(0, 20)}...`);

    const url = `${MEXC_API_BASE}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "ApiKey": apiKey,
      "Request-Time": timestamp,
      "Signature": signature,
      "User-Agent": USER_AGENT,
    };
    
    // Add cookies if provided
    if (cookies) {
      try {
        // Clean cookies - remove any invalid characters that might cause header issues
        // Remove newlines, carriage returns, and other control characters
        let cleanedCookies = cookies.replace(/[\r\n\t]/g, '').trim();
        
        // Remove any null bytes or other problematic characters
        cleanedCookies = cleanedCookies.replace(/\0/g, '');
        
        // Check if cookies are too long (HTTP headers have limits)
        const MAX_COOKIE_LENGTH = 8192; // Typical HTTP header limit
        if (cleanedCookies.length > MAX_COOKIE_LENGTH) {
          console.warn(`   ⚠️  Cookies занадто довгі (${cleanedCookies.length} символів), обрізаю до ${MAX_COOKIE_LENGTH}`);
          cleanedCookies = cleanedCookies.substring(0, MAX_COOKIE_LENGTH);
        }
        
        // Validate cookie string (basic check)
        if (cleanedCookies.length > 0) {
          headers["Cookie"] = cleanedCookies;
          console.log(`   ✅ Cookies додано до запиту (довжина: ${cleanedCookies.length} символів)`);
        } else {
          console.warn(`   ⚠️  Cookies порожні після очищення, пропускаю`);
        }
      } catch (error: any) {
        console.error(`   ❌ Помилка при обробці cookies: ${error?.message}`);
        console.warn(`   ⚠️  Продовжую без cookies`);
      }
    }
    
    // Add Recv-Window (optional, default 5000ms)
    // According to MEXC docs, this is optional but can help with timing issues
    const recvWindow = "5000"; // 5 seconds window
    headers["Recv-Window"] = recvWindow;
    console.log(`   Recv-Window: ${recvWindow}ms`);

    console.log(`🌐 Відправка запиту:`);
    console.log(`   URL: ${url}`);
    console.log(`   Method: POST`);
    console.log(`   Headers:`, {
      "Content-Type": headers["Content-Type"],
      "ApiKey": `${apiKey.substring(0, 8)}...`,
      "Request-Time": headers["Request-Time"],
      "Signature": `${signature.substring(0, 20)}...`,
    });

    // Generate curl command for Postman
    // Note: Cookies are not included in the curl command to avoid message length limits
    // Cookies are automatically added to the actual request
    const curlCommandForPostman = `curl -X POST "${url}" -H "Content-Type: application/json" -H "ApiKey: ${apiKey}" -H "Request-Time: ${timestamp}" -H "Signature: ${signature}" -H "Recv-Window: ${recvWindow}" -H "User-Agent: ${USER_AGENT}" -d '${bodyString}'`;
    
    // Also provide multi-line version (Postman accepts both)
    const curlCommandMultiLine = `curl -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -H "ApiKey: ${apiKey}" \\
  -H "Request-Time: ${timestamp}" \\
  -H "Signature: ${signature}" \\
  -H "Recv-Window: ${recvWindow}" \\
  -H "User-Agent: ${USER_AGENT}" \\
  -d '${bodyString}'`;
    
    // Store curl command for return (use single-line version for easier copying)
    const curlCommand = curlCommandForPostman;
    
    console.log('─'.repeat(80));
    console.log('📋 [CURL COMMAND] Скопіюйте команду та вставте в Postman (Import -> Raw text):');
    console.log('─'.repeat(80));
    console.log('');
    if (cookies) {
      console.log('⚠️  Примітка: Cookies не включені в curl команду (занадто довгі), але додаються автоматично до запиту.');
      console.log('');
    }
    console.log('📌 Однорядкова версія (рекомендовано для Postman):');
    console.log(curlCommandForPostman);
    console.log('');
    console.log('📌 Багаторядкова версія (альтернатива):');
    console.log(curlCommandMultiLine);
    console.log('');
    console.log('─'.repeat(80));
    console.log(`💡 Формат підпису: accessKey + timestamp + body`);
    console.log(`💡 Приклад: ${apiKey.substring(0, 8)}...${timestamp}${bodyString.substring(0, 50)}...`);
    console.log(`💡 Timestamp в мілісекундах (Date.now()): ${timestamp}`);
    console.log(`💡 Recv-Window: ${recvWindow}ms (опціональний параметр)`);
    console.log(`💡 Vol обмежено до 8 знаків після коми: ${volRounded}`);

    let response: Response;
    let responseText: string;
    const requestStartTime = Date.now();
    
    try {
      console.log(`⏳ Відправка запиту...`);
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: headers,
        body: bodyString, // Use the same body string that was used for signature
      }, REQUEST_TIMEOUT);

      const requestDuration = Date.now() - requestStartTime;
      console.log(`⏱️  Час відповіді: ${requestDuration}ms`);
      console.log(`📊 Статус відповіді: ${response.status} ${response.statusText}`);

      responseText = await response.text();
      console.log(`📥 Відповідь отримано (довжина: ${responseText.length} символів)`);
      console.log(`📄 Response Text:`, responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
    } catch (fetchError: any) {
      console.error(fetchError);
      const requestDuration = Date.now() - requestStartTime;
      console.error(`❌ [ERROR] Помилка під час запиту (час: ${requestDuration}ms):`, fetchError);
      console.error(`   Error type:`, fetchError?.constructor?.name);
      console.error(`   Error message:`, fetchError?.message);
      console.error(`   Error stack:`, fetchError?.stack);
      
      // Handle network/connection errors
      const errorMessage = fetchError?.message || 'Невідома помилка';
      
      if (errorMessage.includes('http2') || errorMessage.includes('stream error')) {
        console.error(`❌ HTTP/2 помилка виявлена`);
        return {
          success: false,
          message: `Помилка з'єднання з MEXC API (HTTP/2 помилка). Можливі причини:\n` +
                   `• Тимчасові проблеми з мережею\n` +
                   `• Проблеми на стороні MEXC сервера\n` +
                   `• Занадто багато одночасних запитів\n\n` +
                   `Спробуйте через кілька секунд.`,
          curlCommand: curlCommand,
        };
      }
      
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        console.error(`❌ Таймаут виявлено`);
        return {
          success: false,
          message: `Таймаут з'єднання з MEXC API. Сервер не відповідає вчасно.`,
          curlCommand: curlCommand,
        };
      }
      
      console.error(`❌ Інша помилка з'єднання`);
      return {
        success: false,
        message: `Помилка з'єднання: ${errorMessage}`,
        curlCommand: curlCommand,
      };
    }

    // Ensure responseText is set
    if (!responseText) {
      return {
        success: false,
        message: `Помилка: порожня відповідь від сервера`,
        curlCommand: curlCommand,
      };
    }

    // Check if response is ok
    if (!response.ok) {
      console.error(`❌ [ERROR] HTTP статус помилки: ${response.status}`);
      let errorData: any = null;
      try {
        errorData = JSON.parse(responseText);
        console.error(`📋 Парсована помилка:`, JSON.stringify(errorData, null, 2));
      } catch (parseError) {
        console.error(`⚠️  Не вдалося розпарсити помилку як JSON`);
        console.error(`📄 Raw error text:`, responseText);
      }
      
      const errorMessage = formatMEXCError(
        errorData,
        `HTTP помилка ${response.status}: ${responseText.substring(0, 200)}`
      );
      
      console.error(`❌ [RESULT] Помилка відкриття позиції`);
      console.error(`   Message: ${errorMessage}`);
      console.log('='.repeat(80));
      
      return {
        success: false,
        message: errorMessage,
        data: errorData,
        curlCommand: curlCommand,
      };
    }

    // Parse JSON response
    let data: any;
    try {
      console.log(`🔍 Парсинг JSON відповіді...`);
      data = JSON.parse(responseText);
      console.log(`✅ JSON успішно розпарсено`);
      console.log(`📋 Parsed Data:`, JSON.stringify(data, null, 2));
    } catch (parseError: any) {
      console.error(`❌ [ERROR] Не вдалося розпарсити відповідь як JSON`);
      console.error(`   Parse error:`, parseError?.message);
      console.error(`   Response text:`, responseText);
      console.log('='.repeat(80));
      
      return {
        success: false,
        message: `Помилка: не вдалося розпарсити відповідь від сервера`,
        curlCommand: curlCommand,
      };
    }

    // According to MEXC API docs: success = true means success, data contains order id
    if (data.success === true || data.code === 0) {
      const orderId = data.data || data.orderId || 'N/A';
      console.log(`✅ [SUCCESS] Позицію успішно відкрито!`);
      console.log(`📊 Order ID: ${orderId}`);
      console.log(`📊 Full Response:`, JSON.stringify(data, null, 2));
      console.log('='.repeat(80));
      
      return {
        success: true,
        message: `Позицію успішно відкрито. Order ID: ${orderId}`,
        data: data.data || data,
        curlCommand: curlCommand,
      };
    } else {
      const errorMessage = formatMEXCError(data, `Помилка API: ${data.message || `код ${data.code || 'невідомий'}`}`);
      
      console.error(`❌ [ERROR] Помилка API`);
      console.error(`   Success: ${data.success}`);
      console.error(`   Code: ${data.code || 'N/A'}`);
      console.error(`   Message: ${errorMessage}`);
      console.error(`   Full response:`, JSON.stringify(data, null, 2));
      console.log('='.repeat(80));
      
      return {
        success: false,
        message: errorMessage,
        data: data,
        curlCommand: curlCommand,
      };
    }
  } catch (error: any) {
    console.error(`❌ [ERROR] Несподівана помилка під час відкриття позиції`);
    console.error(`   Error type:`, error?.constructor?.name);
    console.error(`   Error message:`, error?.message);
    console.error(`   Error stack:`, error?.stack);
    console.log('='.repeat(80));
    
    const errorMessage = error?.message || 'Невідома помилка';
    
    // Provide more context based on error type
    if (errorMessage.includes('signature') || errorMessage.includes('auth')) {
      return {
        success: false,
        message: `Помилка автентифікації: ${errorMessage}\n\nПеревірте правильність API ключа та секрета.`,
      };
    }
    
    return {
      success: false,
      message: `Помилка: ${errorMessage}`,
    };
  }
}

bot.command("start", async (ctx) => {
  const chat_id = ctx.message.chat.id;

  console.log('chat_id:', chat_id);
  console.log(JSON.stringify(ctx.message));

  const { data: user, error } = await supabase
    .from('mexc_users')
    .select('*')
    .eq('chat_id', chat_id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      const { error: insertError } = await supabase
        .from('mexc_users')
        .insert({ chat_id, });
  
      if (insertError) {
        console.error(insertError);
        return;
      }
    } else {
      console.error(error);
      return;
    }
  }

  await ctx.reply("Welcome to MEXC Bot!");
});

bot.command("help", async (ctx) => {
  const helpMessage = `
📚 Доступні команди:

🆕 Налаштування:
• /addSettings - Додати нові налаштування
  Приклад: /addSettings symbol=BTCUSDT mode=USD usd_amount=100 side=long leverage=10
  
• /listSettings - Показати всі налаштування
  
• /getSettings <id> - Показати налаштування за ID
  Приклад: /getSettings 1

👥 Акаунти:
• /addAccount - Додати новий акаунт
  Приклад: /addAccount label=acc_1 api_key=your_key api_secret=your_secret number_id=1 is_enabled=true
  
• /listAccounts - Показати всі акаунти
  
• /getAccount <id> - Показати акаунт за ID
  Приклад: /getAccount 1
  
• /deleteAccount <id> - Видалити акаунт за ID або number_id
  Приклад: /deleteAccount 1 або /deleteAccount number_id=5

📈 Трейдинг:
• /openTrade <settings_id> - Відкрити трейди на всіх активних акаунтах
  Приклад: /openTrade 1
  Відкриє позиції згідно з налаштуваннями на всіх увімкнених акаунтах

• /openAll <settings_id> - Відкрити трейди на всіх активних акаунтах
  Приклад: /openAll 1
  Те саме що /openTrade

• /open<number> <settings_id> - Відкрити трейди на акаунтах з number_id від 1 до <number>
  Приклад: /open5 1 - відкриє трейди на акаунтах з number_id 1, 2, 3, 4, 5
  Приклад: /open10 1 - відкриє трейди на акаунтах з number_id від 1 до 10

• /closeAll - Закрити всі позиції на всіх активних акаунтах
  Приклад: /closeAll

• /close<number> - Закрити позиції на акаунтах з number_id від 1 до <number>
  Приклад: /close5 - закриє позиції на акаунтах з number_id 1, 2, 3, 4, 5
  Приклад: /close10 - закриє позиції на акаунтах з number_id від 1 до 10

ℹ️ Інші:
• /start - Початок роботи з ботом
• /help - Показати цю довідку
• /contracts - Показати список доступних контрактів для торгівлі
• /contract <symbol> - Перевірити деталі конкретного контракту
  Приклад: /contract BTCUSDT

📝 Параметри для addSettings:
• symbol - наприклад: BTCUSDT (обов'язково)
• mode - USD або TOKEN (обов'язково)
• side - long або short (обов'язково)
• usd_amount - сума в USD (опціонально)
• token_amount - кількість токенів (опціонально)
• leverage - плече (опціонально)
• price - ціна вручну (опціонально, якщо API не працює)

📝 Параметри для addAccount:
• label - назва акаунта (обов'язково)
• api_key - API ключ (обов'язково)
• api_secret - API секрет (обов'язково)
• number_id - унікальний номер акаунта (обов'язково, унікальний лише в межах вашого chat_id)
• is_enabled - чи увімкнено акаунт: true/false (опціонально, за замовчуванням: true)
• cookies - cookies для емуляції браузера (опціонально)
`;

  await ctx.reply(helpMessage);
});

bot.command("contracts", async (ctx) => {
  try {
    await safeReply(ctx, "🔄 Отримую список доступних контрактів...");
    
    const result = await getAvailableContracts();
    
    if (!result.success || !result.contracts) {
      await safeReply(ctx, `❌ Помилка: ${result.message || 'Не вдалося отримати список контрактів'}`);
      return;
    }
  
  const contracts = result.contracts;
  
  // Format contracts list
  let message = `📋 Доступні контракти для торгівлі (всього: ${contracts.length}):\n\n`;
  message += `💡 Для перевірки підтримки API використайте: /contract <symbol>\n\n`;
  
  // Group by base symbol (e.g., BTC, ETH, XRP)
  const grouped: Record<string, any[]> = {};
  
  for (const contract of contracts) {
    if (contract.symbol) {
      // Extract base symbol (e.g., "BTC_USDT" -> "BTC")
      const baseSymbol = contract.symbol.split('_')[0];
      if (!grouped[baseSymbol]) {
        grouped[baseSymbol] = [];
      }
      grouped[baseSymbol].push(contract);
    }
  }
  
  // Sort base symbols
  const sortedSymbols = Object.keys(grouped).sort();
  
  // Show first 50 contracts to avoid message length limit
  let count = 0;
  const maxContracts = 50;
  
  for (const baseSymbol of sortedSymbols) {
    if (count >= maxContracts) {
      message += `\n... та ще ${contracts.length - maxContracts} контрактів`;
      break;
    }
    
    const symbolContracts = grouped[baseSymbol];
    for (const contract of symbolContracts) {
      if (count >= maxContracts) break;
      
      const symbol = contract.symbol || 'N/A';
      const lastPrice = contract.lastPrice ? parseFloat(contract.lastPrice).toFixed(4) : 'N/A';
      const volume24 = contract.volume24 ? parseFloat(contract.volume24).toLocaleString() : 'N/A';
      
      message += `• ${symbol} - Ціна: ${lastPrice} USDT`;
      if (volume24 !== 'N/A') {
        message += ` | Об'єм 24г: ${volume24}`;
      }
      message += `\n`;
      
      count++;
    }
  }
  
  message += `\n💡 Використовуйте символ у форматі: BTCUSDT, ETHUSDT, XRPUSDT тощо`;
  message += `\n💡 Бот автоматично конвертує їх у формат MEXC: BTC_USDT, ETH_USDT, XRP_USDT`;
  
  // Split message if too long
  if (message.length > 4000) {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = message.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 4000) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    for (const chunk of chunks) {
      await safeReply(ctx, chunk);
    }
  } else {
    await safeReply(ctx, message);
  }
  } catch (error: any) {
    console.error(`❌ Помилка в команді /contracts:`, error);
    await safeReply(ctx, `❌ Помилка: ${error?.message || 'Невідома помилка'}`);
  }
});

bot.command("contract", async (ctx) => {
  const messageText = ctx.message.text || '';
  const parts = messageText.split(' ');
  const symbol = parts[1];
  
  if (!symbol) {
    await ctx.reply(
      "Використання: /contract <symbol>\n\n" +
      "Приклад: /contract BTCUSDT\n" +
      "Приклад: /contract XRPUSDT\n\n" +
      "Ця команда покаже деталі контракту, включаючи підтримку API."
    );
    return;
  }
  
  await ctx.reply(`🔄 Перевіряю контракт ${symbol}...`);
  
  const result = await getContractDetail(symbol);
  
  if (!result.success || !result.detail) {
    await ctx.reply(`❌ Помилка: ${result.message || 'Не вдалося отримати деталі контракту'}`);
    return;
  }
  
  const detail = result.detail;
  const mexcSymbol = convertSymbolFormat(symbol);
  
  let message = `📋 Деталі контракту: ${mexcSymbol}\n\n`;
  
  if (detail.symbol) {
    message += `🔹 Символ: ${detail.symbol}\n`;
  }
  
  if (detail.contractId) {
    message += `🔹 ID контракту: ${detail.contractId}\n`;
  }
  
  if (detail.apiAllowed !== undefined) {
    const apiStatus = detail.apiAllowed ? '✅ Підтримується' : '❌ Не підтримується';
    message += `🔹 Підтримка API: ${apiStatus} (apiAllowed: ${detail.apiAllowed})\n`;
  } else {
    message += `🔹 Підтримка API: ⚠️ Не вказано\n`;
  }
  
  if (detail.lastPrice) {
    message += `🔹 Поточна ціна: ${parseFloat(detail.lastPrice).toFixed(4)} USDT\n`;
  }
  
  if (detail.volume24) {
    message += `🔹 Об'єм 24г: ${parseFloat(detail.volume24).toLocaleString()}\n`;
  }
  
  if (detail.leverage) {
    message += `🔹 Максимальне плече: ${detail.leverage}x\n`;
  }
  
  message += `\n💡 Використовуйте символ у форматі: BTCUSDT, ETHUSDT, XRPUSDT тощо`;
  
  await ctx.reply(message);
});

bot.command("commands", async (ctx) => {
  await ctx.reply("Використайте /help для перегляду всіх команд");
});

// Helper function to parse parameters from command text
function parseParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts = text.split(' ').slice(1); // Skip command name
  
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    if (key && valueParts.length > 0) {
      params[key] = valueParts.join('='); // Handle values with '=' in them
    }
  }
  
  return params;
}

bot.command("addSettings", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const params = parseParams(commandText);

  // Validate required parameters
  if (!params.symbol || !params.mode || !params.side) {
    await ctx.reply(
      "Використання: /addSettings symbol=BTCUSDT mode=USD usd_amount=100 side=long leverage=10\n\n" +
      "Обов'язкові параметри:\n" +
      "• symbol - наприклад: BTCUSDT\n" +
      "• mode - USD або TOKEN\n" +
      "• side - long або short\n\n" +
      "Опціональні параметри:\n" +
      "• usd_amount - сума в USD на один акаунт при режимі USD\n" +
      "• token_amount - кількість токенів на один акаунт при режимі TOKEN\n" +
      "• leverage - плече\n" +
      "• price - ціна вручну (якщо API не працює, можна вказати ціну вручну)"
    );
    return;
  }

  // Validate mode
  if (params.mode !== 'USD' && params.mode !== 'TOKEN') {
    await ctx.reply("Помилка: mode повинен бути 'USD' або 'TOKEN'");
    return;
  }

  // Validate side
  if (params.side !== 'long' && params.side !== 'short') {
    await ctx.reply("Помилка: side повинен бути 'long' або 'short'");
    return;
  }

  // Prepare data for insertion
  const settingsData: any = {
    chat_id: chat_id,
    symbol: params.symbol,
    mode: params.mode,
    side: params.side,
  };

  // Add optional parameters if provided
  if (params.usd_amount) {
    settingsData.usd_amount = parseFloat(params.usd_amount);
    if (isNaN(settingsData.usd_amount)) {
      await ctx.reply("Помилка: usd_amount повинен бути числом");
      return;
    }
  }

  if (params.token_amount) {
    settingsData.token_amount = parseFloat(params.token_amount);
    if (isNaN(settingsData.token_amount)) {
      await ctx.reply("Помилка: token_amount повинен бути числом");
      return;
    }
  }

  if (params.leverage) {
    settingsData.leverage = parseFloat(params.leverage);
    if (isNaN(settingsData.leverage)) {
      await ctx.reply("Помилка: leverage повинен бути числом");
      return;
    }
  }

  if (params.price) {
    settingsData.price = parseFloat(params.price);
    if (isNaN(settingsData.price) || settingsData.price <= 0) {
      await ctx.reply("Помилка: price повинен бути додатнім числом");
      return;
    }
  }

  // Insert into database
  const { data, error } = await supabase
    .from('settings')
    .insert(settingsData)
    .select();

  if (error) {
    console.error('Error adding settings:', error);
    await ctx.reply(`Помилка при додаванні налаштувань: ${error.message}`);
    return;
  }

  await ctx.reply(`✅ Налаштування успішно додано!\n\n${JSON.stringify(data[0], null, 2)}`);
});

bot.command("addAccount", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const params = parseParams(commandText);

  // Validate required parameters
  if (!params.label || !params.api_key || !params.api_secret || !params.number_id) {
    await ctx.reply(
      "Використання: /addAccount label=acc_1 api_key=your_key api_secret=your_secret number_id=1 is_enabled=true cookies=your_cookies\n\n" +
      "Обов'язкові параметри:\n" +
      "• label - назва акаунта (наприклад: acc_1, binance_2)\n" +
      "• api_key - API ключ\n" +
      "• api_secret - API секрет\n" +
      "• number_id - унікальний номер акаунта (унікальний лише в межах вашого chat_id)\n\n" +
      "Опціональні параметри:\n" +
      "• is_enabled - чи увімкнено акаунт (true/false, за замовчуванням: true)\n" +
      "• cookies - cookies для емуляції браузера (опціонально)"
    );
    return;
  }

  // Check if number_id already exists for this chat_id
  const { data: existingAccount } = await supabase
    .from('accounts')
    .select('number_id')
    .eq('chat_id', chat_id)
    .eq('number_id', parseInt(params.number_id))
    .single();

  if (existingAccount) {
    await ctx.reply(`Помилка: Акаунт з number_id ${params.number_id} вже існує для вашого chat_id. Оберіть інший number_id.`);
    return;
  }

  // Validate number_id is a number
  const numberId = parseInt(params.number_id);
  if (isNaN(numberId)) {
    await ctx.reply("Помилка: number_id повинен бути числом");
    return;
  }

  // Prepare data for insertion
  const accountData: any = {
    chat_id: chat_id,
    label: params.label,
    api_key: params.api_key,
    api_secret: params.api_secret,
    number_id: numberId,
    is_enabled: params.is_enabled !== undefined 
      ? params.is_enabled.toLowerCase() === 'true' 
      : true, // Default to true if not provided
  };

  // Add cookies if provided
  if (params.cookies) {
    accountData.cookies = params.cookies;
  }

  // Insert into database
  const { data, error } = await supabase
    .from('accounts')
    .insert(accountData)
    .select();

  if (error) {
    console.error('Error adding account:', error);
    // Check if error is due to unique constraint
    if (error.message.includes('unique') || error.message.includes('duplicate')) {
      await ctx.reply(`Помилка: Акаунт з number_id ${numberId} вже існує для вашого chat_id. Оберіть інший number_id.`);
      return;
    }
    await ctx.reply(`Помилка при додаванні акаунта: ${error.message}`);
    return;
  }

  // Don't show sensitive data in response
  const maskedKey = data[0].api_key.length > 4 
    ? '***' + data[0].api_key.slice(-4) 
    : '****';
  const maskedSecret = data[0].api_secret.length > 4 
    ? '***' + data[0].api_secret.slice(-4) 
    : '****';
  
  const responseData = {
    ...data[0],
    api_key: maskedKey,
    api_secret: maskedSecret,
  };

  await ctx.reply(`✅ Акаунт успішно додано!\n\n${JSON.stringify(responseData, null, 2)}`);
});

bot.command("listSettings", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('chat_id', chat_id)
    .order('id', { ascending: false });

  if (error) {
    console.error('Error fetching settings:', error);
    await ctx.reply(`Помилка при отриманні налаштувань: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    await ctx.reply("Налаштування не знайдено.");
    return;
  }

  // Format settings for display
  let message = `📋 Налаштування (всього: ${data.length}):\n\n`;
  
  data.forEach((setting, index) => {
    message += `${index + 1}. ID: ${setting.id}\n`;
    message += `   Symbol: ${setting.symbol || 'N/A'}\n`;
    message += `   Mode: ${setting.mode || 'N/A'}\n`;
    message += `   Side: ${setting.side || 'N/A'}\n`;
    
    if (setting.usd_amount) {
      message += `   USD Amount: ${setting.usd_amount}\n`;
    }
    
    if (setting.token_amount) {
      message += `   Token Amount: ${setting.token_amount}\n`;
    }
    
    if (setting.leverage) {
      message += `   Leverage: ${setting.leverage}\n`;
    }
    
    if (setting.created_at) {
      message += `   Створено: ${new Date(setting.created_at).toLocaleString('uk-UA')}\n`;
    }
    
    message += '\n';
  });

  // Split message if too long (Telegram limit is 4096 characters)
  if (message.length > 4000) {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = message.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 4000) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    for (const chunk of chunks) {
      await safeReply(ctx, chunk);
    }
  } else {
    await safeReply(ctx, message);
  }
});

bot.command("listAccounts", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('chat_id', chat_id)
    .order('id', { ascending: false });

  if (error) {
    console.error('Error fetching accounts:', error);
    await ctx.reply(`Помилка при отриманні акаунтів: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    await ctx.reply("Акаунти не знайдено.");
    return;
  }

  // Format accounts for display (with masked sensitive data)
  let message = `👥 Акаунти (всього: ${data.length}):\n\n`;
  
  data.forEach((account, index) => {
    const maskedKey = account.api_key && account.api_key.length > 4 
      ? '***' + account.api_key.slice(-4) 
      : '****';
    const maskedSecret = account.api_secret && account.api_secret.length > 4 
      ? '***' + account.api_secret.slice(-4) 
      : '****';
    
    message += `${index + 1}. ID: ${account.id}\n`;
    message += `   Number ID: ${account.number_id || 'N/A'}\n`;
    message += `   Label: ${account.label || 'N/A'}\n`;
    message += `   Enabled: ${account.is_enabled ? '✅ Так' : '❌ Ні'}\n`;
    message += `   API Key: ${maskedKey}\n`;
    message += `   API Secret: ${maskedSecret}\n`;
    
    if (account.created_at) {
      message += `   Створено: ${new Date(account.created_at).toLocaleString('uk-UA')}\n`;
    }
    
    message += '\n';
  });

  // Split message if too long (Telegram limit is 4096 characters)
  if (message.length > 4000) {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = message.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 4000) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    for (const chunk of chunks) {
      await safeReply(ctx, chunk);
    }
  } else {
    await safeReply(ctx, message);
  }
});

bot.command("getSettings", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const parts = commandText.split(' ');
  const id = parts[1];

  if (!id) {
    await ctx.reply("Використання: /getSettings <id>\n\nПриклад: /getSettings 1");
    return;
  }

  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('id', parseInt(id))
    .eq('chat_id', chat_id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      await ctx.reply(`Налаштування з ID ${id} не знайдено.`);
      return;
    }
    console.error('Error fetching settings:', error);
    await ctx.reply(`Помилка при отриманні налаштувань: ${error.message}`);
    return;
  }

  let message = `📋 Налаштування #${data.id}:\n\n`;
  message += `Symbol: ${data.symbol || 'N/A'}\n`;
  message += `Mode: ${data.mode || 'N/A'}\n`;
  message += `Side: ${data.side || 'N/A'}\n`;
  
  if (data.usd_amount) {
    message += `USD Amount: ${data.usd_amount}\n`;
  }
  
  if (data.token_amount) {
    message += `Token Amount: ${data.token_amount}\n`;
  }
  
  if (data.leverage) {
    message += `Leverage: ${data.leverage}\n`;
  }
  
  if (data.created_at) {
    message += `Створено: ${new Date(data.created_at).toLocaleString('uk-UA')}\n`;
  }

  await ctx.reply(message);
});

bot.command("getAccount", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const parts = commandText.split(' ');
  const id = parts[1];

  if (!id) {
    await ctx.reply("Використання: /getAccount <id>\n\nПриклад: /getAccount 1");
    return;
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', parseInt(id))
    .eq('chat_id', chat_id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      await ctx.reply(`Акаунт з ID ${id} не знайдено.`);
      return;
    }
    console.error('Error fetching account:', error);
    await ctx.reply(`Помилка при отриманні акаунта: ${error.message}`);
    return;
  }

  const maskedKey = data.api_key && data.api_key.length > 4 
    ? '***' + data.api_key.slice(-4) 
    : '****';
  const maskedSecret = data.api_secret && data.api_secret.length > 4 
    ? '***' + data.api_secret.slice(-4) 
    : '****';

  let message = `👥 Акаунт #${data.id}:\n\n`;
  message += `Number ID: ${data.number_id || 'N/A'}\n`;
  message += `Label: ${data.label || 'N/A'}\n`;
  message += `Enabled: ${data.is_enabled ? '✅ Так' : '❌ Ні'}\n`;
  message += `API Key: ${maskedKey}\n`;
  message += `API Secret: ${maskedSecret}\n`;
  
  if (data.created_at) {
    message += `Створено: ${new Date(data.created_at).toLocaleString('uk-UA')}\n`;
  }

  await ctx.reply(message);
});

bot.command("deleteAccount", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const parts = commandText.split(' ');
  const id = parts[1];

  if (!id) {
    await ctx.reply("Використання: /deleteAccount <id>\n\nПриклад: /deleteAccount 1\n\nВи також можете видалити за number_id: /deleteAccount number_id=5");
    return;
  }

  // Check if using number_id parameter
  const params = parseParams(commandText);
  let accountToDelete: any = null;

  if (params.number_id) {
    // Delete by number_id
    const numberId = parseInt(params.number_id);
    if (isNaN(numberId)) {
      await ctx.reply("Помилка: number_id повинен бути числом");
      return;
    }

    // First, find the account
    const { data: accountData, error: fetchError } = await supabase
      .from('accounts')
      .select('*')
      .eq('number_id', numberId)
      .eq('chat_id', chat_id)
      .single();

    if (fetchError || !accountData) {
      await ctx.reply(`Акаунт з number_id ${numberId} не знайдено або він не належить вам.`);
      return;
    }

    accountToDelete = accountData;
  } else {
    // Delete by id
    const accountId = parseInt(id);
    if (isNaN(accountId)) {
      await ctx.reply("Помилка: ID повинен бути числом");
      return;
    }

    // First, find the account to get its info
    const { data: accountData, error: fetchError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('chat_id', chat_id)
      .single();

    if (fetchError || !accountData) {
      if (fetchError?.code === 'PGRST116') {
        await ctx.reply(`Акаунт з ID ${accountId} не знайдено або він не належить вам.`);
        return;
      }
      console.error('Error fetching account:', fetchError);
      await ctx.reply(`Помилка при отриманні акаунта: ${fetchError?.message || 'Невідома помилка'}`);
      return;
    }

    accountToDelete = accountData;
  }

  // Delete the account
  const deleteId = params.number_id ? accountToDelete.id : parseInt(id);
  const { error: deleteError } = await supabase
    .from('accounts')
    .delete()
    .eq('id', deleteId)
    .eq('chat_id', chat_id);

  if (deleteError) {
    console.error('Error deleting account:', deleteError);
    await ctx.reply(`Помилка при видаленні акаунта: ${deleteError.message}`);
    return;
  }

  await ctx.reply(`✅ Акаунт "${accountToDelete.label}" (Number ID: ${accountToDelete.number_id}) успішно видалено!`);
});

bot.command("openTrade", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const parts = commandText.split(' ');
  const settingsId = parts[1];

  if (!settingsId) {
    await ctx.reply(
      "Використання: /openTrade <settings_id>\n\n" +
      "Приклад: /openTrade 1\n\n" +
      "Ця команда відкриє трейди на всіх активних акаунтах згідно з налаштуваннями."
    );
    return;
  }

  // Get settings
  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('*')
    .eq('id', parseInt(settingsId))
    .eq('chat_id', chat_id)
    .single();

  if (settingsError || !settings) {
    await ctx.reply(`Помилка: Налаштування з ID ${settingsId} не знайдено.`);
    return;
  }

  // Validate required settings
  if (!settings.symbol || !settings.side || !settings.mode) {
    await ctx.reply("Помилка: Налаштування не містять обов'язкових параметрів (symbol, side, mode).");
    return;
  }

  // Get all enabled accounts
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .eq('chat_id', chat_id)
    .eq('is_enabled', true);

  if (accountsError || !accounts || accounts.length === 0) {
    await ctx.reply("Помилка: Не знайдено активних акаунтів.");
    return;
  }

  // Get current price - use price from settings if available, otherwise fetch from API
  let currentPrice: number | null = null;
  
  if (settings.price && settings.price > 0) {
    currentPrice = settings.price;
    console.log(`Using manual price from settings: ${currentPrice}`);
  } else {
    currentPrice = await getCurrentPrice(settings.symbol);
    if (!currentPrice) {
      await ctx.reply(
        `❌ Помилка: Не вдалося отримати поточну ціну для ${settings.symbol}.\n\n` +
        `Можливі причини:\n` +
        `• Неправильний формат символу (перевірте, чи символ існує на MEXC ф'ючерсах)\n` +
        `• Проблеми з API MEXC\n` +
        `• Символ не підтримується для ф'ючерсів\n\n` +
        `Рішення: Додайте параметр price в налаштування:\n` +
        `/addSettings symbol=${settings.symbol} mode=${settings.mode} side=${settings.side} price=<ціна> ...\n\n` +
        `Перевірте правильність символу на сайті MEXC. Для ф'ючерсів символ повинен бути у форматі, наприклад: XRPUSDT, BTCUSDT тощо.`
      );
      return;
    }
  }

  // Ensure currentPrice is valid
  if (!currentPrice || currentPrice <= 0) {
    await ctx.reply(`❌ Помилка: Невалідна ціна: ${currentPrice}`);
    return;
  }

  await ctx.reply(`🔄 Починаю відкриття трейдів...\n\nНалаштування: ${settings.symbol}, ${settings.side}, ${settings.mode}\nАкаунтів: ${accounts.length}\nПоточна ціна: ${currentPrice}`);

  const results: string[] = [];
  let successCount = 0;
  let failCount = 0;

  // Open trades for each account
  for (const account of accounts) {
    try {
      // Calculate quantity based on mode
      let quantity = 0;
      
      if (settings.mode === 'USD' && settings.usd_amount) {
        // Calculate quantity based on USD amount and current price
        quantity = settings.usd_amount / currentPrice;
      } else if (settings.mode === 'TOKEN' && settings.token_amount) {
        quantity = settings.token_amount;
      } else {
        results.push(`❌ ${account.label}: Не вказано суму для відкриття`);
        failCount++;
        continue;
      }

      // Open position
      const result = await openMEXCPosition(
        account.api_key,
        account.api_secret,
        settings.symbol,
        settings.side,
        quantity,
        settings.leverage || undefined,
        "MARKET",
        undefined,
        account.cookies
      );

      if (result.success) {
        results.push(`✅ ${account.label} (${account.number_id}): Позицію відкрито. Кількість: ${quantity.toFixed(6)}`);
        successCount++;
      } else {
        results.push(`❌ ${account.label} (${account.number_id}): ${result.message}`);
        failCount++;
      }
    } catch (error: any) {
      results.push(`❌ ${account.label} (${account.number_id}): Помилка - ${error?.message || 'Невідома помилка'}`);
      failCount++;
    }
  }

  // Send results
  let resultMessage = `📊 Результати відкриття трейдів:\n\n`;
  resultMessage += `✅ Успішно: ${successCount}\n`;
  resultMessage += `❌ Помилок: ${failCount}\n\n`;
  resultMessage += `Деталі:\n${results.join('\n')}`;

  // Split message if too long
  if (resultMessage.length > 4000) {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = resultMessage.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 4000) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } else {
    await ctx.reply(resultMessage);
  }
});

// Helper function to open trades for accounts
async function openTradesForAccounts(
  accounts: any[],
  settings: any,
  currentPrice: number | null
): Promise<{ results: string[]; successCount: number; failCount: number; curlCommands: string[] }> {
  const results: string[] = [];
  const curlCommands: string[] = [];
  let successCount = 0;
  let failCount = 0;

  if (!currentPrice || currentPrice <= 0) {
    results.push(`❌ Помилка: Невалідна ціна: ${currentPrice}`);
    return { results, successCount, failCount, curlCommands: [] };
  }

  for (const account of accounts) {
    try {
      // Calculate quantity based on mode
      let quantity = 0;
      
      if (settings.mode === 'USD' && settings.usd_amount) {
        quantity = settings.usd_amount / currentPrice;
      } else if (settings.mode === 'TOKEN' && settings.token_amount) {
        quantity = settings.token_amount;
      } else {
        results.push(`❌ ${account.label}: Не вказано суму для відкриття`);
        failCount++;
        continue;
      }

      // Open position
      const result = await openMEXCPosition(
        account.api_key,
        account.api_secret,
        settings.symbol,
        settings.side,
        quantity,
        settings.leverage || undefined,
        "MARKET",
        undefined,
        account.cookies
      );

      // Store curl command if available
      if (result.curlCommand) {
        curlCommands.push(result.curlCommand);
      }

      if (result.success) {
        results.push(`✅ ${account.label} (${account.number_id}): Позицію відкрито. Кількість: ${quantity.toFixed(6)}`);
        successCount++;
      } else {
        results.push(`❌ ${account.label} (${account.number_id}): ${result.message}`);
        failCount++;
      }
    } catch (error: any) {
      results.push(`❌ ${account.label} (${account.number_id}): Помилка - ${error?.message || 'Невідома помилка'}`);
      failCount++;
    }
  }

  return { results, successCount, failCount, curlCommands };
}

bot.command("openAll", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const commandText = ctx.message.text || '';
  const parts = commandText.split(' ');
  const settingsId = parts[1];

  if (!settingsId) {
    await ctx.reply(
      "Використання: /openAll <settings_id>\n\n" +
      "Приклад: /openAll 1\n\n" +
      "Ця команда відкриє трейди на всіх активних акаунтах згідно з налаштуваннями."
    );
    return;
  }

  // Get settings
  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('*')
    .eq('id', parseInt(settingsId))
    .eq('chat_id', chat_id)
    .single();

  if (settingsError || !settings) {
    await ctx.reply(`Помилка: Налаштування з ID ${settingsId} не знайдено.`);
    return;
  }

  // Validate required settings
  if (!settings.symbol || !settings.side || !settings.mode) {
    await ctx.reply("Помилка: Налаштування не містять обов'язкових параметрів (symbol, side, mode).");
    return;
  }

  // Get all enabled accounts
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .eq('chat_id', chat_id)
    .eq('is_enabled', true)
    .order('number_id', { ascending: true });

  if (accountsError || !accounts || accounts.length === 0) {
    await ctx.reply("Помилка: Не знайдено активних акаунтів.");
    return;
  }

  // Get current price - use price from settings if available, otherwise fetch from API
  let currentPrice: number | null = null;
  
  if (settings.price && settings.price > 0) {
    currentPrice = settings.price;
    console.log(`Using manual price from settings: ${currentPrice}`);
  } else {
    currentPrice = await getCurrentPrice(settings.symbol);
    if (!currentPrice) {
      await ctx.reply(
        `❌ Помилка: Не вдалося отримати поточну ціну для ${settings.symbol}.\n\n` +
        `Можливі причини:\n` +
        `• Неправильний формат символу (перевірте, чи символ існує на MEXC ф'ючерсах)\n` +
        `• Проблеми з API MEXC\n` +
        `• Символ не підтримується для ф'ючерсів\n\n` +
        `Рішення: Додайте параметр price в налаштування:\n` +
        `/addSettings symbol=${settings.symbol} mode=${settings.mode} side=${settings.side} price=<ціна> ...\n\n` +
        `Перевірте правильність символу на сайті MEXC. Для ф'ючерсів символ повинен бути у форматі, наприклад: XRPUSDT, BTCUSDT тощо.`
      );
      return;
    }
  }

  await ctx.reply(`🔄 Починаю відкриття трейдів на всіх акаунтах...\n\nНалаштування: ${settings.symbol}, ${settings.side}, ${settings.mode}\nАкаунтів: ${accounts.length}\nПоточна ціна: ${currentPrice}`);

  const { results, successCount, failCount, curlCommands } = await openTradesForAccounts(accounts, settings, currentPrice);

  // Send results
  let resultMessage = `📊 Результати відкриття трейдів:\n\n`;
  resultMessage += `✅ Успішно: ${successCount}\n`;
  resultMessage += `❌ Помилок: ${failCount}\n\n`;
  resultMessage += `Деталі:\n${results.join('\n')}`;

  // Create inline keyboard with curl copy button if curl commands are available
  let keyboard: InlineKeyboard | undefined;
  if (curlCommands.length > 0) {
    // Store curl command index in callback data (use first command)
    keyboard = new InlineKeyboard().text("📋 Показати curl", "show_curl_0");
  }

  // Split message if too long
  if (resultMessage.length > 4000) {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = resultMessage.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 4000) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    // Send all chunks except the last one without keyboard
    for (let i = 0; i < chunks.length - 1; i++) {
      await ctx.reply(chunks[i]);
    }
    
    // Send last chunk with keyboard if available
    if (chunks.length > 0) {
      await ctx.reply(chunks[chunks.length - 1], { reply_markup: keyboard });
    }
  } else {
    await ctx.reply(resultMessage, { reply_markup: keyboard });
  }
  
  // Send curl command if available
  if (curlCommands.length > 0) {
    const curlCommand = curlCommands[0]; // Use first command
    await safeSendCurlCommand(ctx, curlCommand);
  }
});

// Handle open<number> command (e.g., open5, open10)
bot.hears(/^\/open(\d+)(?:\s+(\d+))?$/i, async (ctx) => {
  const messageText = ctx.message.text || '';
  const chat_id = ctx.message.chat.id;

  const openMatch = messageText.match(/^\/open(\d+)(?:\s+(\d+))?$/i);
  if (!openMatch) return;
  
  const maxNumberId = parseInt(openMatch[1]);
  const settingsId = openMatch[2] || null;

    if (!settingsId) {
      await ctx.reply(
        "Використання: /open<number> <settings_id>\n\n" +
        "Приклад: /open5 1\n\n" +
        "Ця команда відкриє трейди на акаунтах з number_id від 1 до <number>."
      );
      return;
    }

    // Get settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .eq('id', parseInt(settingsId))
      .eq('chat_id', chat_id)
      .single();

    if (settingsError || !settings) {
      await ctx.reply(`Помилка: Налаштування з ID ${settingsId} не знайдено.`);
      return;
    }

    // Validate required settings
    if (!settings.symbol || !settings.side || !settings.mode) {
      await ctx.reply("Помилка: Налаштування не містять обов'язкових параметрів (symbol, side, mode).");
      return;
    }

    // Get accounts with number_id from 1 to maxNumberId
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('*')
      .eq('chat_id', chat_id)
      .eq('is_enabled', true)
      .gte('number_id', 1)
      .lte('number_id', maxNumberId)
      .order('number_id', { ascending: true });

    if (accountsError || !accounts || accounts.length === 0) {
      await ctx.reply(`Помилка: Не знайдено активних акаунтів з number_id від 1 до ${maxNumberId}.`);
      return;
    }

    // Get current price
    const currentPrice = await getCurrentPrice(settings.symbol);
    if (!currentPrice) {
      await ctx.reply(`Помилка: Не вдалося отримати поточну ціну для ${settings.symbol}.`);
      return;
    }

    await ctx.reply(`🔄 Починаю відкриття трейдів на акаунтах з number_id 1-${maxNumberId}...\n\nНалаштування: ${settings.symbol}, ${settings.side}, ${settings.mode}\nАкаунтів: ${accounts.length}\nПоточна ціна: ${currentPrice}`);

    const { results, successCount, failCount, curlCommands } = await openTradesForAccounts(accounts, settings, currentPrice);

    // Send results
    let resultMessage = `📊 Результати відкриття трейдів (number_id 1-${maxNumberId}):\n\n`;
    resultMessage += `✅ Успішно: ${successCount}\n`;
    resultMessage += `❌ Помилок: ${failCount}\n\n`;
    resultMessage += `Деталі:\n${results.join('\n')}`;

    // Create inline keyboard with curl copy button if curl commands are available
    let keyboard: InlineKeyboard | undefined;
    if (curlCommands.length > 0) {
      keyboard = new InlineKeyboard().text("📋 Показати curl", "show_curl_0");
    }

    // Split message if too long
    if (resultMessage.length > 4000) {
      const chunks: string[] = [];
      let currentChunk = '';
      const lines = resultMessage.split('\n');
      
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > 4000) {
          chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      // Send all chunks except the last one without keyboard
      for (let i = 0; i < chunks.length - 1; i++) {
        await ctx.reply(chunks[i]);
      }
      
      // Send last chunk with keyboard if available
      if (chunks.length > 0) {
        await ctx.reply(chunks[chunks.length - 1], { reply_markup: keyboard });
      }
    } else {
      await ctx.reply(resultMessage, { reply_markup: keyboard });
    }
    
    // Send curl command if available
    if (curlCommands.length > 0) {
      const curlCommand = curlCommands[0]; // Use first command
      await safeSendCurlCommand(ctx, curlCommand);
    }
});

// Handle close<number> command (e.g., close5, close10)
bot.hears(/^\/close(\d+)$/i, async (ctx) => {
  const messageText = ctx.message.text || '';
  const closeMatch = messageText.match(/^\/close(\d+)$/i);
  if (!closeMatch) return;
  
  const maxNumberId = parseInt(closeMatch[1]);
    const chat_id = ctx.message.chat.id;

    // Get accounts with number_id from 1 to maxNumberId
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('*')
      .eq('chat_id', chat_id)
      .eq('is_enabled', true)
      .gte('number_id', 1)
      .lte('number_id', maxNumberId)
      .order('number_id', { ascending: true });

    if (accountsError || !accounts || accounts.length === 0) {
      await ctx.reply(`Помилка: Не знайдено активних акаунтів з number_id від 1 до ${maxNumberId}.`);
      return;
    }

    // Get the first account's symbol from settings (or use a default)
    const { data: settings } = await supabase
      .from('settings')
      .select('symbol')
      .eq('chat_id', chat_id)
      .order('id', { ascending: false })
      .limit(1)
      .single();

    if (!settings || !settings.symbol) {
      await ctx.reply("Помилка: Не знайдено налаштувань з символом для закриття позицій.");
      return;
    }

    await ctx.reply(`🔄 Починаю закриття позицій на акаунтах з number_id 1-${maxNumberId}...\n\nСимвол: ${settings.symbol}\nАкаунтів: ${accounts.length}`);

    const results: string[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const account of accounts) {
      try {
        const result = await closeMEXCPosition(
          account.api_key,
          account.api_secret,
          settings.symbol,
          "ISOLATED",
          account.cookies
        );

        if (result.success) {
          results.push(`✅ ${account.label} (${account.number_id}): Позицію закрито`);
          successCount++;
        } else {
          results.push(`❌ ${account.label} (${account.number_id}): ${result.message}`);
          failCount++;
        }
      } catch (error: any) {
        results.push(`❌ ${account.label} (${account.number_id}): Помилка - ${error?.message || 'Невідома помилка'}`);
        failCount++;
      }
    }

    // Send results
    let resultMessage = `📊 Результати закриття позицій (number_id 1-${maxNumberId}):\n\n`;
    resultMessage += `✅ Успішно: ${successCount}\n`;
    resultMessage += `❌ Помилок: ${failCount}\n\n`;
    resultMessage += `Деталі:\n${results.join('\n')}`;

    // Split message if too long
    if (resultMessage.length > 4000) {
      const chunks: string[] = [];
      let currentChunk = '';
      const lines = resultMessage.split('\n');
      
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > 4000) {
          chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(resultMessage);
    }
});

bot.command("closeAll", async (ctx) => {
  const chat_id = ctx.message.chat.id;

  // Get all enabled accounts
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .eq('chat_id', chat_id)
    .eq('is_enabled', true)
    .order('number_id', { ascending: true });

  if (accountsError || !accounts || accounts.length === 0) {
    await ctx.reply("Помилка: Не знайдено активних акаунтів.");
    return;
  }

  // Get the first account's symbol from settings (or use a default)
  const { data: settings } = await supabase
    .from('settings')
    .select('symbol')
    .eq('chat_id', chat_id)
    .order('id', { ascending: false })
    .limit(1)
    .single();

  if (!settings || !settings.symbol) {
    await ctx.reply("Помилка: Не знайдено налаштувань з символом для закриття позицій.");
    return;
  }

  await ctx.reply(`🔄 Починаю закриття позицій на всіх акаунтах...\n\nСимвол: ${settings.symbol}\nАкаунтів: ${accounts.length}`);

  const results: string[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const account of accounts) {
    try {
      const result = await closeMEXCPosition(
        account.api_key,
        account.api_secret,
        settings.symbol
      );

      if (result.success) {
        results.push(`✅ ${account.label} (${account.number_id}): Позицію закрито`);
        successCount++;
      } else {
        results.push(`❌ ${account.label} (${account.number_id}): ${result.message}`);
        failCount++;
      }
    } catch (error: any) {
      results.push(`❌ ${account.label} (${account.number_id}): Помилка - ${error?.message || 'Невідома помилка'}`);
      failCount++;
    }
  }

  // Send results
  let resultMessage = `📊 Результати закриття позицій:\n\n`;
  resultMessage += `✅ Успішно: ${successCount}\n`;
  resultMessage += `❌ Помилок: ${failCount}\n\n`;
  resultMessage += `Деталі:\n${results.join('\n')}`;

  // Split message if too long
  if (resultMessage.length > 4000) {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = resultMessage.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 4000) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } else {
    await ctx.reply(resultMessage);
  }
});

// Handle callback query for curl copy button
bot.callbackQuery("copy_curl", async (ctx) => {
  await ctx.answerCallbackQuery("Curl команда вже відправлена в попередньому повідомленні");
});

// Handle callback query for showing curl
bot.callbackQuery(/^show_curl_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Curl команда вже відправлена в попередньому повідомленні");
});

// Error handler for bot to prevent hanging
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`❌ Помилка в боті:`, err.error);
  console.error(`   Update:`, JSON.stringify(ctx.update).substring(0, 200));
  
  // Try to send error message to user
  if (ctx && ctx.chat) {
    safeReply(ctx, `⚠️ Виникла помилка: ${err.error?.message || 'Невідома помилка'}`).catch((replyError) => {
      console.error(`❌ Не вдалося відправити повідомлення про помилку:`, replyError);
    });
  }
});

const handleUpdate = webhookCallback(bot, "std/http");

serve(async (req) => {
  // Handle OPTIONS requests for CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const response = await handleUpdate(req);
    return response;
  } catch (err) {
    console.error("Error handling update:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
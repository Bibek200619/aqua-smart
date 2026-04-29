#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <time.h>
#include <math.h>

const char* WIFI_NAME = "Roushan";
const char* WIFI_PASS = "roushan213";

String apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZmZ1aWFjbHhsa2xkcWp1dndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjU5NzcsImV4cCI6MjA5Mjk0MTk3N30.JxKn4OywOS2-SxeWyiwfVxta-mqhHw2LMLKiDPd1pQo";
String baseUrl = "https://moffuiaclxlkldqjuvwk.supabase.co";
String tableUrl = baseUrl + "/rest/v1/tank?id=eq.1";

// NodeMCU ESP8266 pins. Change these if your wiring is different.
#define TRIG_PIN D1
#define ECHO_PIN D2
#define RELAY_PIN D5
#define BUZZER_PIN D6

// Most relay modules are active LOW. If your motor logic is reversed, set this false.
const bool RELAY_ACTIVE_LOW = true;
const bool BUZZER_ACTIVE_LOW = false;

const float LOW_START_CM = 12.0;       // Start pump and buzzer when distance is more than this.
const float LOW_BUZZER_OFF_CM = 10.0;  // Stop low-level buzzer after water reaches this.
const float FULL_WARN_CM = 7.0;        // Start full warning buzzer below this.
const float FULL_STOP_CM = 5.0;        // Stop pump when water reaches this.

const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long SUPABASE_INTERVAL_MS = 5000;

bool pumpOn = false;
bool buzzerOn = false;
String statusText = "IDLE";
String modeText = "AUTO";
float lastDistanceCm = NAN;

void writeOutput(uint8_t pin, bool on, bool activeLow) {
  int level = activeLow ? (on ? LOW : HIGH) : (on ? HIGH : LOW);
  digitalWrite(pin, level);
}

void setPump(bool on) {
  pumpOn = on;
  writeOutput(RELAY_PIN, pumpOn, RELAY_ACTIVE_LOW);
}

void setBuzzer(bool on) {
  buzzerOn = on;
  writeOutput(BUZZER_PIN, buzzerOn, BUZZER_ACTIVE_LOW);
}

bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("WiFi connection failed.");
  return false;
}

void syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Syncing clock");

  unsigned long start = millis();
  time_t now = time(nullptr);
  while (now < 1700000000 && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println();
}

String isoTimestamp() {
  time_t now = time(nullptr);
  if (now < 1700000000) return "";

  struct tm* timeInfo = gmtime(&now);
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", timeInfo);
  return String(buffer);
}

float readDistanceOnceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return NAN;

  return duration * 0.0343 / 2.0;
}

float readAverageDistanceCm() {
  float total = 0.0;
  int count = 0;

  for (int i = 0; i < 5; i++) {
    float d = readDistanceOnceCm();
    if (!isnan(d) && d >= 2.0 && d <= 400.0) {
      total += d;
      count++;
    }
    delay(40);
  }

  if (count == 0) return NAN;
  return total / count;
}

void applyAutomaticControl(float distanceCm) {
  if (isnan(distanceCm)) {
    setPump(false);
    setBuzzer(true);
    statusText = "SENSOR_ERROR";
    return;
  }

  if (!pumpOn) {
    if (distanceCm > LOW_START_CM) {
      setPump(true);
      setBuzzer(true);
      statusText = "LOW_LEVEL_PUMP_ON";
    } else {
      setPump(false);
      setBuzzer(false);
      statusText = distanceCm <= FULL_STOP_CM ? "FULL" : "IDLE";
    }
    return;
  }

  if (distanceCm <= FULL_STOP_CM) {
    setPump(false);
    setBuzzer(false);
    statusText = "FULL_PUMP_OFF";
  } else if (distanceCm < FULL_WARN_CM) {
    setPump(true);
    setBuzzer(true);
    statusText = "FULL_WARNING";
  } else if (distanceCm <= LOW_BUZZER_OFF_CM) {
    setPump(true);
    setBuzzer(false);
    statusText = "FILLING";
  } else {
    setPump(true);
    setBuzzer(true);
    statusText = "LOW_LEVEL_FILLING";
  }
}

void sendToSupabase() {
  if (!ensureWiFi()) return;

  BearSSL::WiFiClientSecure client;
  client.setInsecure();  // Simple HTTPS mode for ESP8266.

  HTTPClient https;
  if (!https.begin(client, tableUrl)) {
    Serial.println("Could not connect to Supabase URL.");
    return;
  }

  String payload = "{";
  payload += "\"distance\":";
  if (isnan(lastDistanceCm)) {
    payload += "null";
  } else {
    payload += String(lastDistanceCm, 1);
  }
  payload += ",\"status\":\"";
  payload += statusText;
  payload += "\"";
  payload += ",\"pump\":";
  payload += pumpOn ? "true" : "false";
  payload += ",\"buzzer\":";
  payload += buzzerOn ? "true" : "false";
  payload += ",\"mode\":\"";
  payload += modeText;
  payload += "\"";

  String timestamp = isoTimestamp();
  if (timestamp.length() > 0) {
    payload += ",\"updated_at\":\"";
    payload += timestamp;
    payload += "\"";
  }
  payload += "}";

  https.addHeader("apikey", apiKey);
  https.addHeader("Authorization", String("Bearer ") + apiKey);
  https.addHeader("Content-Type", "application/json");
  https.addHeader("Prefer", "return=minimal");

  int httpCode = https.PATCH(payload);
  Serial.print("Supabase HTTP code: ");
  Serial.println(httpCode);

  if (httpCode < 200 || httpCode >= 300) {
    Serial.println(https.getString());
  }

  https.end();
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  setPump(false);
  setBuzzer(false);

  ensureWiFi();
  syncClock();
}

void loop() {
  static unsigned long lastSensorRead = 0;
  static unsigned long lastSupabaseSend = 0;

  if (millis() - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = millis();

    lastDistanceCm = readAverageDistanceCm();
    applyAutomaticControl(lastDistanceCm);

    Serial.print("Distance: ");
    if (isnan(lastDistanceCm)) Serial.print("ERROR");
    else Serial.print(lastDistanceCm, 1);
    Serial.print(" cm | Status: ");
    Serial.print(statusText);
    Serial.print(" | Pump: ");
    Serial.print(pumpOn ? "ON" : "OFF");
    Serial.print(" | Buzzer: ");
    Serial.println(buzzerOn ? "ON" : "OFF");
  }

  if (millis() - lastSupabaseSend >= SUPABASE_INTERVAL_MS) {
    lastSupabaseSend = millis();
    sendToSupabase();
  }
}

#include <SD.h>
#include <SPI.h>
#include <DS3231.h>

const int CS_PIN = 10;
const int SENSOR_PIN = A3;
const int LED_PIN = 7;

const float minimumRecordableChange = 0.2f;

File file;
DS3231 rtc(SDA, SCL);

char fileName[50] = "";
char currentTime[50] = "";

char str[100] = "";

double reading = 0, previousReading = 0;

int needsReset = false;
int i;
int sinceLastRecording;

void setup()
{
  Serial.begin(9600);
  rtc.begin();

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  
  pinMode(SENSOR_PIN, INPUT);

  Serial.println("Initializing SD card...");
  pinMode(CS_PIN, OUTPUT);

  if(SD.begin())
    Serial.println("SD card is ready to use.");
  else
  {
    Serial.println("SD card initialization failed");
    needsReset = true;
  }
  
  strcpy(currentTime, rtc.getTimeStr());
  Serial.println(currentTime);
  Serial.println("Beginning data collection");
  for(i = 0; i < 5; ++i)
    FlashLED();

    sinceLastRecording = 0;
}

void loop()
{
  if(needsReset)
  {
    FlashLED();
  }
  else if(strcmp(currentTime, rtc.getTimeStr()) != 0) //wait until it is a new second
  {
    FlashLED(); //flash light to indicate that a reading is being taken
    reading = ProcessReading(analogRead(SENSOR_PIN));
    
    strcpy(currentTime, rtc.getTimeStr());
    Serial.println(currentTime);
    
    if(abs(reading - previousReading) >= minimumRecordableChange || sinceLastRecording >= 59) //the new reading is sufficiently far enough away from the old to require a recording
    {
      sinceLastRecording = 0;
      strcpy(fileName, rtc.getDateStr());
      replaceCharInString(fileName, '.', '-'); // '.' is not a valid character in file name
      FormatDate(fileName);
      strcat(fileName, ".txt");
      
      Serial.print("Opening file ");
      Serial.println(fileName);
      file = SD.open(fileName, FILE_WRITE);
      
      if(!file)
      {
        Serial.println("Failed to open file");
        needsReset = true;
      }
      else
      {
        Serial.println("Writing to file");
        file.print(rtc.getTimeStr());
        file.print(" ");
        file.println(reading);
        
        Serial.println("Closing file");
        file.close();
      }
      Serial.print("Value recorded: ");
      Serial.println(reading);
      
      FlashLED();
      
      previousReading = reading;
    }
    else
    {
      Serial.print(reading);
      Serial.println("; Insufficient change in water level, value not recorded");
      sinceLastRecording++;
    }
  }
}

void FlashLED(void)
{
  digitalWrite(LED_PIN, HIGH);
  delay(50);
  digitalWrite(LED_PIN, LOW);
  delay(50);
}

void replaceCharInString(char *str, char toReplace, char replacement)
{
  for(i = 0; str[i] != '\0'; ++i)
  {
    if(str[i] == toReplace)
    {
      str[i] = replacement;
    }
  }
}

void FormatDate(char *dateStr)
{
  //goes from DD-MM-YYYY to MM-DD-YY
  //must be shortened because max file name size for SD is 8 characters
  dateStr[6] = dateStr[8];
  dateStr[7] = dateStr[9];
  dateStr[8] = '\0';
  dateStr[9] = dateStr[0]; //using dateStr[9] as a temp storage character for swaps
  dateStr[0] = dateStr[3];
  dateStr[3] = dateStr[9];
  dateStr[9] = dateStr[1];
  dateStr[1] = dateStr[4];
  dateStr[4] = dateStr[9];
}

double ProcessReading(int raw)
{
  double height = -7447.8 * (1.0 / (raw * 5.0 / 3.3)) + 20.916;
  
  Serial.print("Raw: ");
  Serial.print(raw);
  Serial.print(",   \tHeight: ");
  Serial.println(height);
  
  return height;
}




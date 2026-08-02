-- Add user profile fields for personalization
ALTER TABLE "User"
ADD COLUMN display_name VARCHAR(100),
ADD COLUMN language_preference VARCHAR(10) DEFAULT 'en',
ADD COLUMN theme_preference VARCHAR(20) DEFAULT 'system';

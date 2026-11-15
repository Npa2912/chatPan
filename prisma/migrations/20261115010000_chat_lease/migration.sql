CREATE TABLE "ChatLease" (
 "conversationId" TEXT NOT NULL PRIMARY KEY,
 "token" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ChatLease_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

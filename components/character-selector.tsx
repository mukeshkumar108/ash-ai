'use client';
import { characters, type Character } from '@/lib/ai/characters';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';

export function CharacterSelector({
  onSelect,
}: {
  onSelect: (character: Character) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-8 bg-background">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-2"
      >
        <h1 className="text-4xl font-bold tracking-tight">Choose Your Girlfriend</h1>
        <p className="text-muted-foreground text-lg">Who would you like to spend time with today?</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        {characters.map((character, index) => (
          <motion.div
            key={character.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="flex flex-col overflow-hidden hover:ring-2 hover:ring-primary transition-all cursor-pointer h-full" onClick={() => onSelect(character)}>
              <div className="aspect-[4/3] relative bg-muted">
                {/* Replace with actual character images later */}
                <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-muted-foreground/20">
                  {character.name[0]}
                </div>
              </div>
              <div className="p-6 flex flex-col flex-1 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-2xl font-semibold">{character.name}</h2>
                  <p className="text-sm text-muted-foreground">{character.description}</p>
                </div>
                <div className="flex-1 italic text-sm text-muted-foreground/80">
                  &quot;{character.greeting}&quot;
                </div>
                <Button className="w-full mt-auto" size="lg">
                  Start Chat
                </Button>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

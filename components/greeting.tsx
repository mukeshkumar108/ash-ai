import { motion } from 'framer-motion';

export const Greeting = () => {
  return (
    <div
      key="overview"
      className="flex flex-col items-center gap-2 text-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}
        className="font-sans text-4xl font-semibold tracking-[-0.02em] text-foreground md:text-5xl"
      >
        How can I help?
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.6 }}
        className="mt-2 max-w-md font-serif text-base leading-snug text-muted-foreground"
      >
        Ask a question, upload an image, or request a document.
      </motion.div>
    </div>
  );
};
